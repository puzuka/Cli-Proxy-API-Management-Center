import { isMap, parse as parseYaml, parseDocument } from 'yaml';
import type {
  Config,
  GeminiKeyConfig,
  ModelAlias,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';

export interface CompactFallbackSettings {
  enabled: boolean;
  model: string;
  appliesToProviders: string[];
  triggerLog: boolean;
}

export interface CustomCompactSettings {
  enabled: boolean;
  model: string;
  maxTokens: string;
  temperature: string;
  maxRetries: string;
  triggerLog: boolean;
}

export interface CompactContextSettings {
  fallback: CompactFallbackSettings;
  custom: CustomCompactSettings;
}

export interface CompactModelOption {
  id: string;
  sourceModel: string;
  providerName: string;
  providerType: string;
  providerRoute?: string;
  providerModelsRoute?: string;
  disabled?: boolean;
}

export interface CompactModelResolution {
  model: string;
  matches: CompactModelOption[];
}

export const DEFAULT_COMPACT_CONTEXT_SETTINGS: CompactContextSettings = {
  fallback: {
    enabled: false,
    model: '',
    appliesToProviders: ['*'],
    triggerLog: false,
  },
  custom: {
    enabled: false,
    model: '',
    maxTokens: '4096',
    temperature: '0.2',
    maxRetries: '1',
    triggerLog: false,
  },
};

type YamlDocument = ReturnType<typeof parseDocument>;
type YamlPath = string[];

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
};

const readString = (value: unknown, fallback = ''): string => {
  if (value === undefined || value === null) return fallback;
  return String(value);
};

const readNumberString = (value: unknown, fallback: string): string => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
};

const normalizeProviderList = (value: unknown): string[] => {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  rawItems.forEach((item) => {
    const trimmed = String(item ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized.length ? normalized : ['*'];
};

const ensureMapInDoc = (doc: YamlDocument, path: YamlPath): void => {
  const existing = doc.getIn(path, true);
  if (isMap(existing)) return;
  doc.setIn(path, doc.createNode({}));
};

const setTrimmedStringInDoc = (doc: YamlDocument, path: YamlPath, value: string): void => {
  const trimmed = value.trim();
  if (trimmed) {
    doc.setIn(path, trimmed);
    return;
  }
  if (doc.hasIn(path)) doc.deleteIn(path);
};

const setNumberStringInDoc = (doc: YamlDocument, path: YamlPath, value: string): void => {
  const trimmed = value.trim();
  if (!trimmed) {
    if (doc.hasIn(path)) doc.deleteIn(path);
    return;
  }

  const parsed = Number(trimmed);
  doc.setIn(path, Number.isFinite(parsed) ? parsed : trimmed);
};

export const normalizeCompactContextSettings = (
  settings: CompactContextSettings
): CompactContextSettings => ({
  fallback: {
    enabled: Boolean(settings.fallback.enabled),
    model: settings.fallback.model.trim(),
    appliesToProviders: normalizeProviderList(settings.fallback.appliesToProviders),
    triggerLog: Boolean(settings.fallback.triggerLog),
  },
  custom: {
    enabled: Boolean(settings.custom.enabled),
    model: settings.custom.model.trim(),
    maxTokens: settings.custom.maxTokens.trim(),
    temperature: settings.custom.temperature.trim(),
    maxRetries: settings.custom.maxRetries.trim(),
    triggerLog: Boolean(settings.custom.triggerLog),
  },
});

export const readCompactSettingsFromYaml = (yamlContent: string): CompactContextSettings => {
  const document = parseDocument(yamlContent);
  if (document.errors.length > 0) {
    throw new Error(document.errors[0]?.message ?? 'Invalid YAML');
  }

  const parsedRaw: unknown = parseYaml(yamlContent) || {};
  const parsed = asRecord(parsedRaw) ?? {};
  const fallback = asRecord(parsed['compact-fallback']) ?? {};
  const custom = asRecord(parsed['custom-compact']) ?? {};

  return {
    fallback: {
      enabled: readBoolean(fallback.enabled, DEFAULT_COMPACT_CONTEXT_SETTINGS.fallback.enabled),
      model: readString(fallback.model, DEFAULT_COMPACT_CONTEXT_SETTINGS.fallback.model),
      appliesToProviders: normalizeProviderList(
        fallback['applies-to-providers'] ??
          DEFAULT_COMPACT_CONTEXT_SETTINGS.fallback.appliesToProviders
      ),
      triggerLog: readBoolean(
        fallback['trigger-log'],
        DEFAULT_COMPACT_CONTEXT_SETTINGS.fallback.triggerLog
      ),
    },
    custom: {
      enabled: readBoolean(custom.enabled, DEFAULT_COMPACT_CONTEXT_SETTINGS.custom.enabled),
      model: readString(custom.model, DEFAULT_COMPACT_CONTEXT_SETTINGS.custom.model),
      maxTokens: readNumberString(
        custom['max-tokens'],
        DEFAULT_COMPACT_CONTEXT_SETTINGS.custom.maxTokens
      ),
      temperature: readNumberString(
        custom.temperature,
        DEFAULT_COMPACT_CONTEXT_SETTINGS.custom.temperature
      ),
      maxRetries: readNumberString(
        custom['max-retries'],
        DEFAULT_COMPACT_CONTEXT_SETTINGS.custom.maxRetries
      ),
      triggerLog: readBoolean(
        custom['trigger-log'],
        DEFAULT_COMPACT_CONTEXT_SETTINGS.custom.triggerLog
      ),
    },
  };
};

export const applyCompactSettingsToYaml = (
  yamlContent: string,
  settings: CompactContextSettings
): string => {
  const normalized = normalizeCompactContextSettings(settings);
  const doc = parseDocument(yamlContent);
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]?.message ?? 'Invalid YAML');
  }
  if (!isMap(doc.contents)) {
    doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  }

  ensureMapInDoc(doc, ['compact-fallback']);
  doc.setIn(['compact-fallback', 'enabled'], normalized.fallback.enabled);
  setTrimmedStringInDoc(doc, ['compact-fallback', 'model'], normalized.fallback.model);
  doc.setIn(['compact-fallback', 'applies-to-providers'], normalized.fallback.appliesToProviders);
  doc.setIn(['compact-fallback', 'trigger-log'], normalized.fallback.triggerLog);

  ensureMapInDoc(doc, ['custom-compact']);
  doc.setIn(['custom-compact', 'enabled'], normalized.custom.enabled);
  setTrimmedStringInDoc(doc, ['custom-compact', 'model'], normalized.custom.model);
  setNumberStringInDoc(doc, ['custom-compact', 'max-tokens'], normalized.custom.maxTokens);
  setNumberStringInDoc(doc, ['custom-compact', 'temperature'], normalized.custom.temperature);
  setNumberStringInDoc(doc, ['custom-compact', 'max-retries'], normalized.custom.maxRetries);
  doc.setIn(['custom-compact', 'trigger-log'], normalized.custom.triggerLog);

  return doc.toString();
};

const isPositiveIntegerString = (value: string): boolean => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
};

const isNonNegativeIntegerString = (value: string): boolean => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
};

const isTemperatureString = (value: string): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2;
};

export const validateCompactSettings = (settings: CompactContextSettings): string[] => {
  const normalized = normalizeCompactContextSettings(settings);
  const errors: string[] = [];

  if (normalized.fallback.enabled && !normalized.fallback.model) {
    errors.push('Compact fallback needs a fallback model when enabled.');
  }
  if (normalized.fallback.enabled && normalized.fallback.appliesToProviders.length === 0) {
    errors.push('Compact fallback needs at least one provider scope.');
  }
  if (!isPositiveIntegerString(normalized.custom.maxTokens)) {
    errors.push('Custom compact max tokens must be a positive integer.');
  }
  if (!isTemperatureString(normalized.custom.temperature)) {
    errors.push('Custom compact temperature must be between 0 and 2.');
  }
  if (!isNonNegativeIntegerString(normalized.custom.maxRetries)) {
    errors.push('Custom compact max retries must be zero or a positive integer.');
  }

  return errors;
};

export const compactSettingsEqual = (
  left: CompactContextSettings,
  right: CompactContextSettings
): boolean =>
  JSON.stringify(normalizeCompactContextSettings(left)) ===
  JSON.stringify(normalizeCompactContextSettings(right));

const hasDisabledAllModelsRule = (excludedModels?: string[]): boolean =>
  Boolean(excludedModels?.some((item) => item.trim() === '*'));

const addModelIds = (ids: Set<string>, model: ModelAlias, prefix?: string): void => {
  const name = model.name.trim();
  const alias = model.alias?.trim();
  const trimmedPrefix = prefix?.trim();

  if (name) ids.add(name);
  if (alias) ids.add(alias);
  if (trimmedPrefix && name) ids.add(`${trimmedPrefix}/${name}`);
  if (trimmedPrefix && alias) ids.add(`${trimmedPrefix}/${alias}`);
};

const pushProviderKeyModels = (
  options: CompactModelOption[],
  providers: Array<GeminiKeyConfig | ProviderKeyConfig> | undefined,
  providerType: string,
  routePrefix: string
): void => {
  providers?.forEach((provider, providerIndex) => {
    const providerName = provider.prefix
      ? `${providerType} (${provider.prefix})`
      : `${providerType} #${providerIndex + 1}`;
    const disabled = hasDisabledAllModelsRule(provider.excludedModels);

    provider.models?.forEach((model) => {
      const ids = new Set<string>();
      addModelIds(ids, model, provider.prefix);
      ids.forEach((id) => {
        options.push({
          id,
          sourceModel: model.name,
          providerName,
          providerType,
          providerRoute: `${routePrefix}/${providerIndex}`,
          disabled,
        });
      });
    });
  });
};

const pushOpenAIProviderModels = (
  options: CompactModelOption[],
  providers: OpenAIProviderConfig[] | undefined
): void => {
  providers?.forEach((provider, providerIndex) => {
    provider.models?.forEach((model) => {
      const ids = new Set<string>();
      addModelIds(ids, model, provider.prefix);
      ids.forEach((id) => {
        options.push({
          id,
          sourceModel: model.name,
          providerName: provider.name,
          providerType: 'OpenAI-compatible',
          providerRoute: `/ai-providers/openai/${providerIndex}`,
          providerModelsRoute: `/ai-providers/openai/${providerIndex}/models`,
          disabled: Boolean(provider.disabled),
        });
      });
    });
  });
};

export const buildCompactModelOptions = (config: Config | null): CompactModelOption[] => {
  if (!config) return [];

  const options: CompactModelOption[] = [];
  pushProviderKeyModels(options, config.geminiApiKeys, 'Gemini', '/ai-providers/gemini');
  pushProviderKeyModels(options, config.codexApiKeys, 'Codex', '/ai-providers/codex');
  pushProviderKeyModels(options, config.claudeApiKeys, 'Claude', '/ai-providers/claude');
  pushProviderKeyModels(options, config.vertexApiKeys, 'Vertex', '/ai-providers/vertex');
  pushOpenAIProviderModels(options, config.openaiCompatibility);

  const seen = new Set<string>();
  return options
    .filter((option) => {
      const key = [
        option.id.toLowerCase(),
        option.providerType,
        option.providerName,
        option.sourceModel,
      ].join('::');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const buildCompactModelSuggestions = (
  options: CompactModelOption[]
): CompactModelOption[] => {
  const byId = new Map<string, CompactModelOption>();
  options.forEach((option) => {
    const key = option.id.toLowerCase();
    if (!byId.has(key)) byId.set(key, option);
  });
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
};

export const resolveCompactModel = (
  model: string,
  options: CompactModelOption[]
): CompactModelResolution => {
  const trimmed = model.trim();
  if (!trimmed) return { model: '', matches: [] };
  const normalized = trimmed.toLowerCase();
  const matches = options.filter((option) => option.id.toLowerCase() === normalized);
  return { model: trimmed, matches };
};
