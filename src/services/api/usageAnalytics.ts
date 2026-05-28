import { apiClient } from './client';

export type UsageAnalyticsPeriod = 'today' | '24h' | '7d' | '30d' | '60d';

export interface UsageTokenTotals {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  total_tokens?: number;
}

export interface UsageAggregate {
  requests?: number;
  success?: number;
  failed?: number;
  tokens?: UsageTokenTotals;
  cost_usd?: number;
}

export interface UsageChartPoint {
  label?: string;
  date?: string;
  requests?: number;
  tokens?: number;
  breakdown?: UsageTokenTotals;
  cost_usd?: number;
}

export interface UsageAnalyticsGroup {
  key?: string;
  provider?: string;
  model?: string;
  account_label?: string;
  api_key_label?: string;
  api_key_name?: string;
  api_key_fingerprint?: string;
  api_key_display_label?: string;
  endpoint?: string;
  last_used?: string;
  requests?: number;
  success?: number;
  failed?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
}

export interface UsageRecentRequest {
  time?: string;
  provider?: string;
  model?: string;
  account_label?: string;
  api_key_label?: string;
  api_key_name?: string;
  api_key_fingerprint?: string;
  api_key_display_label?: string;
  endpoint?: string;
  status_code?: number;
  failed?: boolean;
  total_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
}

export interface UsageAnalyticsSnapshot {
  period?: string;
  usage_statistics_enabled?: boolean;
  retention_days?: number;
  updated_at?: string;
  totals?: UsageAggregate;
  previous_totals?: UsageAggregate;
  series?: UsageChartPoint[];
  recent_requests?: UsageRecentRequest[];
  by_provider?: UsageAnalyticsGroup[];
  by_model?: UsageAnalyticsGroup[];
  by_account?: UsageAnalyticsGroup[];
  by_api_key?: UsageAnalyticsGroup[];
  by_endpoint?: UsageAnalyticsGroup[];
}

export interface UsageRequestDetail {
  id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  api_key_label?: string;
  api_key_name?: string;
  api_key_fingerprint?: string;
  api_key_display_label?: string;
  endpoint?: string;
  status?: string;
  status_code?: number;
  failed?: boolean;
  tokens?: UsageTokenTotals;
  cost_usd?: number;
  latency?: {
    total?: number;
    ttft?: number;
  };
}

export interface UsageRequestDetailsSnapshot {
  details?: UsageRequestDetail[];
  totals?: UsageAggregate;
  pagination?: {
    page?: number;
    page_size?: number;
    total_items?: number;
    total_pages?: number;
    has_next?: boolean;
    has_prev?: boolean;
  };
}

export interface UsageQuotaMetric {
  used?: number;
  limit?: number;
  remaining?: number;
  exceeded?: boolean;
  unlimited?: boolean;
}

export interface UsageQuotaStatus {
  period?: string;
  period_key?: string;
  requests?: number;
  token_quota?: UsageQuotaMetric;
  usd_quota?: UsageQuotaMetric;
  exceeded_metrics?: string[];
  blocked?: boolean;
  store_available?: boolean;
}

export interface UsageAnalyticsAPIKeyDetail {
  key?: {
    id?: string;
    name?: string;
    api_key_name?: string;
    api_key_fingerprint?: string;
    display_label?: string;
    active?: boolean;
  };
  period?: string;
  stats?: UsageAggregate;
  chart?: UsageChartPoint[];
  requests?: UsageRecentRequest[];
  quotas?: UsageQuotaStatus[];
}

export interface UsageRequestDetailsParams {
  page?: number;
  pageSize?: number;
  provider?: string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  status?: string;
  start?: string;
  end?: string;
}

const buildQuery = (values: Record<string, unknown>) => {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
};

export const usageAnalyticsApi = {
  getStats: (period: UsageAnalyticsPeriod) =>
    apiClient.get<UsageAnalyticsSnapshot>(`/usage-analytics/stats${buildQuery({ period })}`),

  getRequestDetails: (params: UsageRequestDetailsParams = {}) =>
    apiClient.get<UsageRequestDetailsSnapshot>(
      `/usage-analytics/request-details${buildQuery({
        page: params.page ?? 1,
        page_size: params.pageSize ?? 25,
        provider: params.provider,
        model: params.model,
        api_key: params.apiKey,
        endpoint: params.endpoint,
        status: params.status,
        start: params.start,
        end: params.end,
      })}`
    ),

  getApiKeyDetail: (id: string, period: UsageAnalyticsPeriod = 'today') =>
    apiClient.get<UsageAnalyticsAPIKeyDetail>(
      `/usage-analytics/api-keys/${encodeURIComponent(id)}${buildQuery({ period })}`
    ),
};
