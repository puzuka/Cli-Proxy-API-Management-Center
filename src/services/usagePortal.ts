import type {
  UsageAggregate,
  UsageDailyPoint,
  UsageRecentRequest,
  UsageSnapshot,
  UsageTokenTotals,
  UsageWindow,
} from '@/types/usagePortal';

const USAGE_REQUEST_TIMEOUT_MS = 15 * 1000;

type UsageErrorPayload = {
  error?: string;
  message?: string;
};

const DEFAULT_TOKENS: UsageTokenTotals = {
  input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  cached_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 0,
};

const DEFAULT_TOTALS: UsageAggregate = {
  requests: 0,
  success: 0,
  failed: 0,
  tokens: DEFAULT_TOKENS,
  cost_usd: 0,
};

export class UsagePortalError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'UsagePortalError';
    this.status = status;
  }
}

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as UsageErrorPayload;
    return payload.error || payload.message || `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const readBoolean = (value: unknown): boolean => value === true;

const readNumber = (value: unknown): number => {
  const next = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
};

const readOptionalString = (value: unknown): string | undefined => {
  const next = readString(value).trim();
  return next || undefined;
};

const readTokens = (input: unknown): UsageTokenTotals => {
  const value = readRecord(input);
  return {
    input_tokens: readNumber(value.input_tokens),
    output_tokens: readNumber(value.output_tokens),
    reasoning_tokens: readNumber(value.reasoning_tokens),
    cached_tokens: readNumber(value.cached_tokens),
    cache_read_tokens: readNumber(value.cache_read_tokens),
    cache_creation_tokens: readNumber(value.cache_creation_tokens),
    total_tokens: readNumber(value.total_tokens),
  };
};

const readAggregate = (input: unknown): UsageAggregate => {
  const value = readRecord(input);
  return {
    requests: readNumber(value.requests),
    success: readNumber(value.success),
    failed: readNumber(value.failed),
    tokens: readTokens(value.tokens),
    cost_usd: readNumber(value.cost_usd),
  };
};

const readDailyPoint = (input: unknown): UsageDailyPoint | null => {
  const value = readRecord(input);
  const date = readString(value.date).trim();
  if (!date) return null;
  return {
    date,
    label: readOptionalString(value.label),
    ...readAggregate(value),
  };
};

const readRecentRequest = (input: unknown): UsageRecentRequest | null => {
  const value = readRecord(input);
  const time = readString(value.time).trim();
  if (!time) return null;
  return {
    time,
    provider: readString(value.provider),
    model: readString(value.model),
    alias: readOptionalString(value.alias),
    source: readOptionalString(value.source),
    account_label: readOptionalString(value.account_label),
    api_key_label: readOptionalString(value.api_key_label),
    auth_index: readOptionalString(value.auth_index),
    auth_type: readOptionalString(value.auth_type),
    endpoint: readOptionalString(value.endpoint),
    request_id: readOptionalString(value.request_id),
    reasoning_effort: readOptionalString(value.reasoning_effort),
    input_tokens: readNumber(value.input_tokens),
    output_tokens: readNumber(value.output_tokens),
    reasoning_tokens: readNumber(value.reasoning_tokens),
    cached_tokens: readNumber(value.cached_tokens),
    total_tokens: readNumber(value.total_tokens),
    cost_usd: readNumber(value.cost_usd),
    latency_ms: readNumber(value.latency_ms),
    status_code: readNumber(value.status_code),
    failed: readBoolean(value.failed),
  };
};

export const normalizeUsageSnapshot = (input: unknown): UsageSnapshot => {
  const value = readRecord(input);
  return {
    key_label: readString(value.key_label),
    active: value.active !== false,
    usage_statistics_enabled: value.usage_statistics_enabled !== false,
    retention_days: readNumber(value.retention_days),
    window_days: readNumber(value.window_days),
    updated_at: readOptionalString(value.updated_at),
    totals: value.totals ? readAggregate(value.totals) : DEFAULT_TOTALS,
    series: Array.isArray(value.series)
      ? value.series.map(readDailyPoint).filter((point): point is UsageDailyPoint => Boolean(point))
      : [],
    recent_requests: Array.isArray(value.recent_requests)
      ? value.recent_requests
          .map(readRecentRequest)
          .filter((request): request is UsageRecentRequest => Boolean(request))
      : [],
  };
};

export const usagePortalApi = {
  async getSnapshot(apiKey: string, window: UsageWindow): Promise<UsageSnapshot> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), USAGE_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `/usage/${encodeURIComponent(apiKey)}/data?window=${encodeURIComponent(window)}`,
        {
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new UsagePortalError(await readErrorMessage(response), response.status);
      }

      return normalizeUsageSnapshot(await response.json());
    } catch (error) {
      if (error instanceof UsagePortalError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new UsagePortalError('Usage request timed out.');
      }
      throw new UsagePortalError(error instanceof Error ? error.message : 'Unable to load usage data.');
    } finally {
      globalThis.clearTimeout(timeout);
    }
  },
};
