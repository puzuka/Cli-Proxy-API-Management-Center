export type UsageWindow = '1d' | '7d' | '30d' | '60d';

export interface UsageTokenTotals {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
}

export interface UsageAggregate {
  requests: number;
  success: number;
  failed: number;
  tokens: UsageTokenTotals;
}

export interface UsageDailyPoint extends UsageAggregate {
  date: string;
}

export interface UsageRecentRequest {
  time: string;
  provider: string;
  model: string;
  alias?: string;
  endpoint?: string;
  request_id?: string;
  reasoning_effort?: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status_code: number;
  failed: boolean;
}

export interface UsageSnapshot {
  key_label: string;
  active: boolean;
  usage_statistics_enabled: boolean;
  retention_days: number;
  window_days: number;
  updated_at?: string;
  totals: UsageAggregate;
  series: UsageDailyPoint[];
  recent_requests: UsageRecentRequest[];
}
