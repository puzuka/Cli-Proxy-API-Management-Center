import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconBot,
  IconChartLine,
  IconCheck,
  IconCode,
  IconExternalLink,
  IconFileText,
  IconInfo,
  IconKey,
  IconModelCluster,
  IconRefreshCw,
  IconScrollText,
  IconSettings,
} from '@/components/ui/icons';
import { configFileApi } from '@/services/api/configFile';
import {
  applyCompactSettingsToYaml,
  buildCompactModelOptions,
  buildCompactModelSuggestions,
  compactSettingsEqual,
  DEFAULT_COMPACT_CONTEXT_SETTINGS,
  readCompactSettingsFromYaml,
  resolveCompactModel,
  validateCompactSettings,
  type CompactContextSettings,
  type CompactFallbackSettings,
  type CompactModelResolution,
  type CustomCompactSettings,
} from '@/services/api/compactConfig';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import styles from './CompactContextPage.module.scss';

const MODEL_SUGGESTIONS_ID = 'compact-context-model-suggestions';

const COMPACT_MANAGED_PATHS = [
  'compact-fallback.enabled',
  'compact-fallback.model',
  'compact-fallback.applies-to-providers',
  'compact-fallback.trigger-log',
  'custom-compact.enabled',
  'custom-compact.model',
  'custom-compact.max-tokens',
  'custom-compact.temperature',
  'custom-compact.max-retries',
  'custom-compact.trigger-log',
];

const JCASC_CONFIG_SECTIONS = [
  {
    id: 'runtime',
    title: 'Runtime, network, routing',
    description:
      'Server bind, TLS, remote management, proxy, retry policy, routing strategy, streaming, headers, and payload rules.',
    paths: [
      'host',
      'port',
      'tls',
      'remote-management',
      'proxy-url',
      'request-retry',
      'routing',
      'streaming',
      'payload',
    ],
    badge: 'Visual editor',
    icon: <IconSettings size={20} />,
    actions: [{ label: 'Open editor', route: '/config' }],
  },
  {
    id: 'providers',
    title: 'Providers and model catalog',
    description:
      'Gemini, Codex, Claude, Vertex, OpenAI-compatible providers, Amp upstream routing, model aliases, and discovered model lists.',
    paths: [
      'gemini-api-key',
      'codex-api-key',
      'claude-api-key',
      'vertex-api-key',
      'openai-compatibility',
      'ampcode',
    ],
    badge: 'Dedicated forms',
    icon: <IconModelCluster size={20} />,
    actions: [
      { label: 'Providers', route: '/ai-providers' },
      { label: 'System models', route: '/system' },
    ],
  },
  {
    id: 'access',
    title: 'Access, API keys, OAuth',
    description:
      'Management API keys, auth file directory, OAuth excluded models, OAuth model aliases, owner metadata, budgets, and expiry policy.',
    paths: ['api-keys', 'auth-dir', 'oauth-excluded-models', 'oauth-model-alias'],
    badge: 'Security controls',
    icon: <IconKey size={20} />,
    actions: [
      { label: 'API keys', route: '/api-keys' },
      { label: 'Auth files', route: '/auth-files' },
      { label: 'OAuth rules', route: '/auth-files/oauth-excluded' },
    ],
  },
  {
    id: 'usage',
    title: 'Quota, usage, logs',
    description:
      'Quota fallback behavior, usage statistics, request logging, log retention, and live log inspection.',
    paths: [
      'quota-exceeded',
      'usage-statistics-enabled',
      'request-log',
      'logging-to-file',
      'logs-max-total-size-mb',
    ],
    badge: 'Operational views',
    icon: <IconChartLine size={20} />,
    actions: [
      { label: 'Quota', route: '/quota' },
      { label: 'Usage', route: '/usage-analytics' },
      { label: 'Logs', route: '/logs' },
    ],
  },
  {
    id: 'compact',
    title: 'Context compact',
    description:
      'Native/fallback compact cascade, custom compact generation, provider scope, trigger logs, and compact model resolution.',
    paths: COMPACT_MANAGED_PATHS,
    badge: 'Inline editor',
    icon: <IconBot size={20} />,
    actions: [{ label: 'Compact editor', anchor: 'compact-editor' }],
  },
  {
    id: 'raw',
    title: 'Raw YAML source of truth',
    description:
      'Every JCasC key remains editable through the full YAML source editor when a specialized visual control does not exist yet.',
    paths: ['/config.yaml'],
    badge: 'Full coverage',
    icon: <IconCode size={20} />,
    actions: [{ label: 'Source YAML', route: '/config' }],
  },
];

const providerScopesToText = (scopes: string[]): string => scopes.join(', ');

const providerScopesFromText = (value: string): string[] => {
  const seen = new Set<string>();
  const scopes: string[] = [];
  value.split(/[\n,]/).forEach((item) => {
    const trimmed = item.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    scopes.push(trimmed);
  });
  return scopes.length ? scopes : ['*'];
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

const formatLastLoaded = (date: Date | null): string => {
  if (!date) return 'Not loaded';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

function ResolutionPanel({
  title,
  model,
  emptyText,
  resolution,
  onOpenRoute,
}: {
  title: string;
  model: string;
  emptyText: string;
  resolution: CompactModelResolution;
  onOpenRoute: (route: string) => void;
}) {
  const trimmedModel = model.trim();

  return (
    <div className={styles.resolutionPanel}>
      <div className={styles.resolutionHeader}>
        <div>
          <div className={styles.resolutionTitle}>{title}</div>
          <div className={styles.resolutionModel}>{trimmedModel || emptyText}</div>
        </div>
        <span
          className={`${styles.statusPill} ${
            trimmedModel && resolution.matches.length > 0
              ? styles.statusOk
              : trimmedModel
                ? styles.statusWarn
                : styles.statusMuted
          }`}
        >
          {trimmedModel && resolution.matches.length > 0
            ? 'Resolved'
            : trimmedModel
              ? 'No exact match'
              : 'Dynamic'}
        </span>
      </div>

      {!trimmedModel ? (
        <div className={styles.emptyResolution}>{emptyText}</div>
      ) : resolution.matches.length === 0 ? (
        <div className={styles.warningBox}>
          The model is saved in compact config, but no configured provider model entry matches it
          exactly.
        </div>
      ) : (
        <div className={styles.matchList}>
          {resolution.matches.map((match) => (
            <div
              className={`${styles.matchRow} ${match.disabled ? styles.matchRowDisabled : ''}`}
              key={`${match.providerType}-${match.providerName}-${match.id}-${match.sourceModel}`}
            >
              <div className={styles.matchMain}>
                <div className={styles.matchProvider}>{match.providerName}</div>
                <div className={styles.matchMeta}>
                  <span>{match.providerType}</span>
                  <span>{match.sourceModel}</span>
                  {match.disabled && <span>Disabled</span>}
                </div>
              </div>
              <div className={styles.matchActions}>
                {match.providerRoute && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenRoute(match.providerRoute as string)}
                    title="Open provider"
                  >
                    <IconExternalLink size={15} />
                    Provider
                  </Button>
                )}
                {match.providerModelsRoute && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenRoute(match.providerModelsRoute as string)}
                    title="Open model discovery"
                  >
                    <IconModelCluster size={15} />
                    Models
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CompactContextPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const { showConfirmation, showNotification } = useNotificationStore();

  const [form, setForm] = useState<CompactContextSettings>(DEFAULT_COMPACT_CONTEXT_SETTINGS);
  const [initialForm, setInitialForm] = useState<CompactContextSettings>(
    DEFAULT_COMPACT_CONTEXT_SETTINGS
  );
  const [providerScopeText, setProviderScopeText] = useState(
    providerScopesToText(DEFAULT_COMPACT_CONTEXT_SETTINGS.fallback.appliesToProviders)
  );
  const [yamlContent, setYamlContent] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';
  const isDirty = !compactSettingsEqual(form, initialForm);
  const validationErrors = useMemo(() => validateCompactSettings(form), [form]);
  const modelOptions = useMemo(() => buildCompactModelOptions(config), [config]);
  const modelSuggestions = useMemo(
    () => buildCompactModelSuggestions(modelOptions),
    [modelOptions]
  );
  const fallbackResolution = useMemo(
    () => resolveCompactModel(form.fallback.model, modelOptions),
    [form.fallback.model, modelOptions]
  );
  const customResolution = useMemo(
    () => resolveCompactModel(form.custom.model, modelOptions),
    [form.custom.model, modelOptions]
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextYaml = await configFileApi.fetchConfigYaml();
      const nextSettings = readCompactSettingsFromYaml(nextYaml);
      setYamlContent(nextYaml);
      setForm(nextSettings);
      setInitialForm(nextSettings);
      setProviderScopeText(providerScopesToText(nextSettings.fallback.appliesToProviders));
      setLastLoadedAt(new Date());

      try {
        await fetchConfig(undefined, true);
      } catch (configError) {
        showNotification(
          `Compact config loaded, provider index refresh failed: ${formatError(configError)}`,
          'warning'
        );
      }
    } catch (loadError) {
      const message = formatError(loadError);
      setError(message);
      showNotification(`Failed to load compact config: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchConfig, showNotification]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateFallback = <K extends keyof CompactFallbackSettings>(
    key: K,
    value: CompactFallbackSettings[K]
  ) => {
    setForm((current) => ({
      ...current,
      fallback: {
        ...current.fallback,
        [key]: value,
      },
    }));
  };

  const updateCustom = <K extends keyof CustomCompactSettings>(
    key: K,
    value: CustomCompactSettings[K]
  ) => {
    setForm((current) => ({
      ...current,
      custom: {
        ...current.custom,
        [key]: value,
      },
    }));
  };

  const handleRefresh = () => {
    if (!isDirty) {
      void loadSettings();
      return;
    }

    showConfirmation({
      title: 'Discard compact changes',
      message: 'Reloading compact config will discard the current unsaved form changes.',
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      variant: 'secondary',
      onConfirm: loadSettings,
    });
  };

  const handleReset = () => {
    setForm(initialForm);
    setProviderScopeText(providerScopesToText(initialForm.fallback.appliesToProviders));
  };

  const handleSave = async () => {
    const settingsToSave: CompactContextSettings = {
      ...form,
      fallback: {
        ...form.fallback,
        appliesToProviders: providerScopesFromText(providerScopeText),
      },
    };
    const errors = validateCompactSettings(settingsToSave);
    if (errors.length > 0) {
      showNotification(errors[0], 'error');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const latestYaml = await configFileApi.fetchConfigYaml();
      const nextYaml = applyCompactSettingsToYaml(latestYaml, settingsToSave);
      await configFileApi.saveConfigYaml(nextYaml);

      const nextSettings = readCompactSettingsFromYaml(nextYaml);
      setYamlContent(nextYaml);
      setForm(nextSettings);
      setInitialForm(nextSettings);
      setProviderScopeText(providerScopesToText(nextSettings.fallback.appliesToProviders));
      setLastLoadedAt(new Date());
      clearCache();
      await fetchConfig(undefined, true);
      showNotification('Compact context config saved and reloaded.', 'success');
    } catch (saveError) {
      const message = formatError(saveError);
      setError(message);
      showNotification(`Failed to save compact config: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openRoute = (route: string) => {
    navigate(route);
  };

  const openCoverageAction = (action: { route?: string; anchor?: string }) => {
    if (action.route) {
      navigate(action.route);
      return;
    }

    if (action.anchor) {
      document
        .getElementById(action.anchor)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const summaryItems = [
    {
      label: 'Fallback',
      value: form.fallback.enabled ? 'Enabled' : 'Off',
      detail: form.fallback.model || 'No fallback model',
      active: form.fallback.enabled,
    },
    {
      label: 'Provider scope',
      value: providerScopesToText(form.fallback.appliesToProviders),
      detail: form.fallback.appliesToProviders.includes('*') ? 'All providers' : 'Scoped',
      active: form.fallback.enabled,
    },
    {
      label: 'Custom compact',
      value: form.custom.enabled ? 'Enabled' : 'Off',
      detail: form.custom.model.trim() || 'Original request model',
      active: form.custom.enabled,
    },
    {
      label: 'Trigger logs',
      value: form.fallback.triggerLog || form.custom.triggerLog ? 'Enabled' : 'Off',
      detail: `${form.fallback.triggerLog ? 'fallback' : 'no fallback'} / ${
        form.custom.triggerLog ? 'custom' : 'no custom'
      }`,
      active: form.fallback.triggerLog || form.custom.triggerLog,
    },
  ];

  const saveDisabled =
    disableControls || loading || saving || !isDirty || validationErrors.length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <div className={styles.eyebrow}>
            <IconSettings size={15} />
            YAML-backed management
          </div>
          <h1 className={styles.pageTitle}>
            {t('jcasc_config.title', { defaultValue: 'JCasC Config Center' })}
          </h1>
          <p className={styles.pageSubtitle}>
            Manage the production source-of-truth YAML from one operator surface: core runtime,
            providers, access policy, quota, logs, and the compact context controls that need
            model-aware validation.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            onClick={handleRefresh}
            disabled={saving || disableControls}
            loading={loading}
          >
            <IconRefreshCw size={16} />
            Refresh
          </Button>
          <Button variant="ghost" onClick={() => navigate('/config')} disabled={saving}>
            <IconScrollText size={16} />
            Source YAML
          </Button>
          <Button onClick={handleSave} disabled={saveDisabled} loading={saving}>
            Save compact
          </Button>
        </div>
      </div>

      {loading && !yamlContent ? (
        <Card className={styles.loadingCard}>
          <LoadingSpinner size={28} />
          <span className={styles.loadingText}>Loading JCasC config...</span>
        </Card>
      ) : (
        <>
          <div className={styles.statusStrip}>
            <span
              className={`${styles.statusPill} ${
                disableControls ? styles.statusWarn : styles.statusOk
              }`}
            >
              {disableControls ? 'Disconnected' : 'Connected'}
            </span>
            <span className={styles.statusText}>{formatLastLoaded(lastLoadedAt)}</span>
            <span className={styles.statusText}>{modelSuggestions.length} configured models</span>
            <span className={styles.statusText}>
              {isDirty ? 'Unsaved compact changes' : 'No unsaved compact changes'}
            </span>
          </div>

          {error && <div className="error-box">{error}</div>}

          {validationErrors.length > 0 && (
            <div className={styles.validationBox}>
              {validationErrors.map((validationError) => (
                <div key={validationError}>{validationError}</div>
              ))}
            </div>
          )}

          <section className={styles.coverageSection} aria-label="JCasC config coverage">
            <div className={styles.sectionHeader}>
              <div>
                <h2>JCasC coverage</h2>
                <p>
                  Each group below maps YAML paths to the current management UI. Use Source YAML for
                  any key that is not yet promoted into a specialized form.
                </p>
              </div>
              <Button variant="secondary" onClick={() => navigate('/config')} disabled={saving}>
                <IconFileText size={16} />
                Source YAML
              </Button>
            </div>

            <div className={styles.coverageGrid}>
              {JCASC_CONFIG_SECTIONS.map((section) => (
                <article className={styles.coveragePanel} key={section.id}>
                  <div className={styles.coverageHeader}>
                    <div className={styles.coverageIcon}>{section.icon}</div>
                    <div className={styles.coverageTitleBlock}>
                      <h3>{section.title}</h3>
                      <span>{section.badge}</span>
                    </div>
                  </div>
                  <p className={styles.coverageDescription}>{section.description}</p>
                  <div className={styles.coveragePaths}>
                    {section.paths.map((path) => (
                      <code key={path}>{path}</code>
                    ))}
                  </div>
                  <div className={styles.coverageActions}>
                    {section.actions.map((action) => (
                      <Button
                        key={`${section.id}-${action.label}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => openCoverageAction(action)}
                      >
                        <IconExternalLink size={15} />
                        {action.label}
                      </Button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className={styles.sectionHeader}>
            <div>
              <h2>Compact context editor</h2>
              <p>
                This section edits only the compact-related YAML blocks. Other JCasC groups open
                through the coverage actions above or the full config editor.
              </p>
            </div>
          </div>

          <section className={styles.summaryGrid} aria-label="Compact context summary">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className={`${styles.summaryTile} ${item.active ? styles.summaryTileActive : ''}`}
              >
                <span className={styles.summaryLabel}>{item.label}</span>
                <strong>{item.value}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </section>

          <datalist id={MODEL_SUGGESTIONS_ID}>
            {modelSuggestions.map((option) => (
              <option
                key={`${option.providerType}-${option.providerName}-${option.id}`}
                value={option.id}
                label={`${option.providerName} (${option.providerType})`}
              />
            ))}
          </datalist>

          <section className={styles.editorGrid} id="compact-editor">
            <Card
              className={styles.configCard}
              title={
                <span className={styles.cardTitle}>
                  <IconModelCluster size={19} />
                  Compact fallback
                </span>
              }
              extra={
                <ToggleSwitch
                  checked={form.fallback.enabled}
                  onChange={(value) => updateFallback('enabled', value)}
                  disabled={saving || disableControls}
                  ariaLabel="Toggle compact fallback"
                />
              }
            >
              <div className={styles.formStack}>
                <Input
                  label="Fallback model"
                  value={form.fallback.model}
                  list={MODEL_SUGGESTIONS_ID}
                  disabled={saving || disableControls}
                  onChange={(event) => updateFallback('model', event.target.value)}
                  error={
                    form.fallback.enabled && !form.fallback.model.trim()
                      ? 'Required while fallback is enabled'
                      : undefined
                  }
                />
                <Input
                  label="Applies to providers"
                  value={providerScopeText}
                  disabled={saving || disableControls}
                  onChange={(event) => {
                    setProviderScopeText(event.target.value);
                    updateFallback(
                      'appliesToProviders',
                      providerScopesFromText(event.target.value)
                    );
                  }}
                  hint="Use * for all providers or comma-separated provider prefixes."
                />
                <div className={styles.toggleRow}>
                  <div>
                    <div className={styles.toggleTitle}>Trigger compact logs</div>
                    <div className={styles.toggleHint}>
                      Writes compact request diagnostics to log files.
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={form.fallback.triggerLog}
                    onChange={(value) => updateFallback('triggerLog', value)}
                    disabled={saving || disableControls}
                    ariaLabel="Toggle fallback compact logging"
                  />
                </div>
              </div>
            </Card>

            <Card
              className={styles.configCard}
              title={
                <span className={styles.cardTitle}>
                  <IconBot size={19} />
                  Custom compact
                </span>
              }
              extra={
                <ToggleSwitch
                  checked={form.custom.enabled}
                  onChange={(value) => updateCustom('enabled', value)}
                  disabled={saving || disableControls}
                  ariaLabel="Toggle custom compact"
                />
              }
            >
              <div className={styles.formStack}>
                <Input
                  label="Compact model"
                  value={form.custom.model}
                  list={MODEL_SUGGESTIONS_ID}
                  disabled={saving || disableControls}
                  onChange={(event) => updateCustom('model', event.target.value)}
                  hint="Leave empty to compact with the original request model."
                />
                <div className={styles.numberGrid}>
                  <Input
                    label="Max tokens"
                    type="number"
                    min={1}
                    value={form.custom.maxTokens}
                    disabled={saving || disableControls}
                    onChange={(event) => updateCustom('maxTokens', event.target.value)}
                  />
                  <Input
                    label="Temperature"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={form.custom.temperature}
                    disabled={saving || disableControls}
                    onChange={(event) => updateCustom('temperature', event.target.value)}
                  />
                  <Input
                    label="Max retries"
                    type="number"
                    min={0}
                    value={form.custom.maxRetries}
                    disabled={saving || disableControls}
                    onChange={(event) => updateCustom('maxRetries', event.target.value)}
                  />
                </div>
                <div className={styles.toggleRow}>
                  <div>
                    <div className={styles.toggleTitle}>Trigger compact logs</div>
                    <div className={styles.toggleHint}>
                      Captures request model and fallback model evidence.
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={form.custom.triggerLog}
                    onChange={(value) => updateCustom('triggerLog', value)}
                    disabled={saving || disableControls}
                    ariaLabel="Toggle custom compact logging"
                  />
                </div>
              </div>
            </Card>
          </section>

          <Card
            className={styles.resolutionCard}
            title={
              <span className={styles.cardTitle}>
                <IconInfo size={19} />
                Model resolution
              </span>
            }
          >
            <div className={styles.resolutionGrid}>
              <ResolutionPanel
                title="Fallback model"
                model={form.fallback.model}
                emptyText="No fallback model configured"
                resolution={fallbackResolution}
                onOpenRoute={openRoute}
              />
              <ResolutionPanel
                title="Custom compact model"
                model={form.custom.model}
                emptyText="Uses the original request model"
                resolution={customResolution}
                onOpenRoute={openRoute}
              />
            </div>
          </Card>

          <Card
            className={styles.pathsCard}
            title={
              <span className={styles.cardTitle}>
                <IconScrollText size={19} />
                Compact YAML paths
              </span>
            }
            extra={
              isDirty ? (
                <span className={`${styles.statusPill} ${styles.statusWarn}`}>Unsaved</span>
              ) : (
                <span className={`${styles.statusPill} ${styles.statusOk}`}>
                  <IconCheck size={14} />
                  Synced
                </span>
              )
            }
          >
            <div className={styles.pathGrid}>
              {COMPACT_MANAGED_PATHS.map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          </Card>

          <div className={styles.saveDock}>
            <div className={styles.saveDockText}>
              <strong>{isDirty ? 'Unsaved changes' : 'Compact config synced'}</strong>
              <span>
                {isDirty
                  ? 'Saving writes only the compact context YAML blocks into the latest server config.'
                  : `Loaded from ${yamlContent ? '/config.yaml' : 'server config'}.`}
              </span>
            </div>
            <div className={styles.saveDockActions}>
              <Button
                variant="secondary"
                onClick={handleReset}
                disabled={!isDirty || saving || loading}
              >
                Reset
              </Button>
              <Button onClick={handleSave} disabled={saveDisabled} loading={saving}>
                Save compact
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
