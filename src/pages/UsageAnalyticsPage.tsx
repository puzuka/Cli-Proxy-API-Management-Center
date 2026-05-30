import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { IconChartLine, IconDownload, IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  usageAnalyticsApi,
  type UsageAnalyticsGroup,
  type UsageAnalyticsAPIKeyDetail,
  type UsageAnalyticsPeriod,
  type UsageAnalyticsSnapshot,
  type UsageChartPoint,
  type UsageTokenTotals,
  type UsageQuotaStatus,
  type UsageRecentRequest,
  type UsageRequestDetailsParams,
  type UsageRequestDetailsSnapshot,
} from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import styles from './UsageAnalyticsPage.module.scss';

const PERIODS: Array<{ label: string; value: UsageAnalyticsPeriod }> = [
  { label: 'Today', value: 'today' },
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '60D', value: '60d' },
];

const METRIC_OPTIONS = [
  { label: 'Tokens', value: 'tokens' },
  { label: 'Cost', value: 'cost' },
  { label: 'Requests', value: 'requests' },
] as const;

const BREAKDOWN_OPTIONS = [
  { label: 'Total', value: 'total' },
  { label: 'Input/Output', value: 'io' },
  { label: 'Cache/Miss', value: 'cache' },
] as const;

type ChartMetric = (typeof METRIC_OPTIONS)[number]['value'];
type ChartBreakdown = (typeof BREAKDOWN_OPTIONS)[number]['value'];
type DriverKind = 'provider' | 'model' | 'account' | 'apiKey' | 'endpoint';
type StreamStatus = 'idle' | 'connecting' | 'connected' | 'error';

type ChartPreferences = {
  period: UsageAnalyticsPeriod;
  metric: ChartMetric;
  breakdown: ChartBreakdown;
  tokenBudget: string;
};

type ChartBucketRange = {
  label: string;
  start?: string;
  end?: string;
};

type ChartBucketSelection = ChartBucketRange & {
  summary: string;
};

type ChartPointView = {
  point: UsageChartPoint;
  label: string;
  value: number;
  range: ChartBucketRange;
  segments: Array<{ key: string; label: string; value: number; className: string }>;
};

type APIKeyIdentitySource = {
  key?: string;
  api_key_label?: string;
  api_key_name?: string;
  api_key_fingerprint?: string;
  api_key_display_label?: string;
};

const STORAGE_KEY = 'cpa-usage-analytics-chart-preferences';
const numberFormatter = new Intl.NumberFormat();
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const percentFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const moneyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

const toNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value: unknown) => numberFormatter.format(toNumber(value));
const formatCompact = (value: unknown) => compactFormatter.format(toNumber(value));
const formatMoney = (value: unknown) => moneyFormatter.format(toNumber(value));
const formatPercent = (value: unknown) => `${percentFormatter.format(toNumber(value))}%`;
const cacheMissTokens = (
  tokens?: Pick<UsageTokenTotals, 'input_tokens' | 'cached_tokens'> | null
) => Math.max(0, toNumber(tokens?.input_tokens) - toNumber(tokens?.cached_tokens));

const streamStatusCopy: Record<StreamStatus, string> = {
  idle: 'Realtime idle',
  connecting: 'Connecting live',
  connected: 'Live',
  error: 'Reconnecting',
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : fallback;

const isAbortLikeError = (err: unknown) => {
  const message = errorMessage(err, '');
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError') ||
    /\babort(ed)?\b/i.test(message) ||
    /BodyStreamBuffer was aborted/i.test(message)
  );
};

const groupLabel = (group: UsageAnalyticsGroup, field: keyof UsageAnalyticsGroup) =>
  String(group[field] || group.key || 'unknown');

const apiKeyIdentity = (source?: APIKeyIdentitySource) => {
  const fingerprint = String(source?.api_key_fingerprint || source?.api_key_label || '').trim();
  const name = String(source?.api_key_name || '').trim();
  const fallback = String(source?.api_key_display_label || fingerprint || source?.key || '').trim();
  const primary = name || fallback || '-';
  return {
    primary,
    secondary: name && fingerprint ? fingerprint : '',
    filterValue: fingerprint || fallback,
  };
};

const readPreferences = (): ChartPreferences => {
  if (typeof window === 'undefined') {
    return { period: 'today', metric: 'tokens', breakdown: 'total', tokenBudget: '' };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ChartPreferences>) : {};
    return {
      period: PERIODS.some((option) => option.value === parsed.period) ? parsed.period! : 'today',
      metric: METRIC_OPTIONS.some((option) => option.value === parsed.metric)
        ? parsed.metric!
        : 'tokens',
      breakdown: BREAKDOWN_OPTIONS.some((option) => option.value === parsed.breakdown)
        ? parsed.breakdown!
        : 'total',
      tokenBudget: typeof parsed.tokenBudget === 'string' ? parsed.tokenBudget : '',
    };
  } catch {
    return { period: 'today', metric: 'tokens', breakdown: 'total', tokenBudget: '' };
  }
};

const metricValue = (point: UsageChartPoint, metric: ChartMetric) => {
  if (metric === 'cost') return toNumber(point.cost_usd);
  if (metric === 'requests') return toNumber(point.requests);
  return toNumber(point.tokens || point.breakdown?.total_tokens);
};

const formatMetricValue = (value: number, metric: ChartMetric, compact = false) => {
  if (metric === 'cost') return formatMoney(value);
  if (metric === 'requests') return formatNumber(value);
  return compact ? formatCompact(value) : `${formatNumber(value)} tokens`;
};

const formatQuotaPeriod = (period?: string) => {
  const normalized = String(period || '').trim();
  if (normalized === 'daily') return 'Daily reset';
  if (normalized === 'one_time') return 'One-time';
  return normalized || '-';
};

const formatTokenQuotaMetric = (metric?: UsageQuotaStatus['token_quota']) => {
  if (!metric || metric.unlimited || !toNumber(metric.limit)) return 'Unlimited';
  return `${formatCompact(metric.used)} / ${formatCompact(metric.limit)} tokens`;
};

const formatUSDQuotaMetric = (metric?: UsageQuotaStatus['usd_quota']) => {
  if (!metric || metric.unlimited || !toNumber(metric.limit)) return 'Unlimited';
  return `${formatMoney(metric.used)} / ${formatMoney(metric.limit)}`;
};

const formatQuotaRemaining = (
  metric: UsageQuotaStatus['token_quota'] | UsageQuotaStatus['usd_quota'] | undefined,
  kind: 'tokens' | 'usd'
) => {
  if (!metric || metric.unlimited || !toNumber(metric.limit)) return 'Unlimited';
  return kind === 'usd'
    ? formatMoney(metric.remaining)
    : `${formatCompact(metric.remaining)} tokens`;
};

const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const bucketRange = (
  point: UsageChartPoint,
  index: number,
  period: UsageAnalyticsPeriod
): ChartBucketRange => {
  const label = point.label || point.date || `Bucket ${index + 1}`;
  if (point.date) {
    const start = new Date(`${point.date}T00:00:00`);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { label, start: start.toISOString(), end: end.toISOString() };
    }
  }
  if ((period === 'today' || period === '24h') && point.label) {
    const [hourText] = point.label.split(':');
    const hour = Number(hourText);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      const start = new Date();
      start.setHours(hour, 0, 0, 0);
      if (period === '24h' && start.getTime() > Date.now()) start.setDate(start.getDate() - 1);
      const end = new Date(start);
      end.setHours(start.getHours() + 1);
      return { label, start: start.toISOString(), end: end.toISOString() };
    }
  }
  return { label };
};

const chartSegments = (point: UsageChartPoint, metric: ChartMetric, breakdown: ChartBreakdown) => {
  if (metric !== 'tokens' || breakdown === 'total') {
    return [
      {
        key: 'total',
        label: metric === 'tokens' ? 'Total' : metric,
        value: metricValue(point, metric),
        className: styles.segmentTotal,
      },
    ];
  }
  const tokens = point.breakdown || {};
  if (breakdown === 'io') {
    const input = toNumber(tokens.input_tokens);
    const output = toNumber(tokens.output_tokens);
    const known = input + output;
    const other = Math.max(0, metricValue(point, metric) - known);
    return [
      { key: 'input', label: 'Input', value: input, className: styles.segmentInput },
      { key: 'output', label: 'Output', value: output, className: styles.segmentOutput },
      { key: 'other', label: 'Other', value: other, className: styles.segmentOther },
    ].filter((segment) => segment.value > 0);
  }
  const cached = toNumber(tokens.cached_tokens);
  const cacheMiss = cacheMissTokens(tokens);
  const output = toNumber(tokens.output_tokens);
  const other = Math.max(0, metricValue(point, metric) - cached - cacheMiss - output);
  return [
    { key: 'cached', label: 'Cached', value: cached, className: styles.segmentCached },
    { key: 'miss', label: 'Cache miss', value: cacheMiss, className: styles.segmentMiss },
    { key: 'output', label: 'Output', value: output, className: styles.segmentOutput },
    { key: 'other', label: 'Other', value: other, className: styles.segmentOther },
  ].filter((segment) => segment.value > 0);
};

const topDriverRows = (snapshot: UsageAnalyticsSnapshot | null) => {
  const sources: Array<{
    kind: DriverKind;
    label: string;
    rows?: UsageAnalyticsGroup[];
    field: keyof UsageAnalyticsGroup;
  }> = [
    { kind: 'provider', label: 'Provider', rows: snapshot?.by_provider, field: 'provider' },
    { kind: 'model', label: 'Model', rows: snapshot?.by_model, field: 'model' },
    { kind: 'account', label: 'Account', rows: snapshot?.by_account, field: 'account_label' },
    { kind: 'apiKey', label: 'API Key', rows: snapshot?.by_api_key, field: 'api_key_label' },
    { kind: 'endpoint', label: 'Endpoint', rows: snapshot?.by_endpoint, field: 'endpoint' },
  ];
  return sources
    .flatMap((source) =>
      (source.rows || []).slice(0, 3).map((row) => {
        const identity = source.kind === 'apiKey' ? apiKeyIdentity(row) : null;
        const label = identity?.primary || groupLabel(row, source.field);
        return {
          kind: source.kind,
          typeLabel: source.label,
          label,
          secondary: identity?.secondary || '',
          filterValue: identity?.filterValue || label,
          row,
          tokens: toNumber(row.total_tokens),
          cost: toNumber(row.cost_usd),
          failed: toNumber(row.failed),
        };
      })
    )
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.failed - a.failed)
    .slice(0, 8);
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.statCard}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function APIKeyIdentityLabel({ value }: { value?: APIKeyIdentitySource }) {
  const identity = apiKeyIdentity(value);
  if (identity.primary === '-') return <span>-</span>;
  return (
    <span className={styles.apiKeyIdentity}>
      <span className={styles.apiKeyIdentityName}>{identity.primary}</span>
      {identity.secondary && (
        <span className={styles.apiKeyIdentityFingerprint}>{identity.secondary}</span>
      )}
    </span>
  );
}

function GroupTable({
  title,
  rows,
  labelField,
  apiKeyIdentityColumn = false,
  onApiKeySelect,
}: {
  title: string;
  rows?: UsageAnalyticsGroup[];
  labelField: keyof UsageAnalyticsGroup;
  apiKeyIdentityColumn?: boolean;
  onApiKeySelect?: (id: string) => void;
}) {
  const visibleRows = [...(rows || [])]
    .sort(
      (a, b) =>
        toNumber(b.cost_usd) - toNumber(a.cost_usd) ||
        toNumber(b.total_tokens) - toNumber(a.total_tokens)
    )
    .slice(0, 10);

  return (
    <section className={styles.panel}>
      <h3>{title}</h3>
      {visibleRows.length === 0 ? (
        <div className={styles.emptyState}>No data</div>
      ) : (
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Requests</th>
                <th>Input</th>
                <th>Cached</th>
                <th>Miss</th>
                <th>Output</th>
                <th>Reasoning</th>
                <th>Total</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${groupLabel(row, labelField)}-${index}`}>
                  <td>
                    {apiKeyIdentityColumn ? (
                      <button
                        type="button"
                        className={styles.identityButton}
                        onClick={() => onApiKeySelect?.(apiKeyIdentity(row).filterValue)}
                        disabled={!onApiKeySelect}
                      >
                        <APIKeyIdentityLabel value={row} />
                      </button>
                    ) : (
                      groupLabel(row, labelField)
                    )}
                  </td>
                  <td>{formatNumber(row.requests)}</td>
                  <td>{formatNumber(row.input_tokens)}</td>
                  <td>{formatNumber(row.cached_tokens)}</td>
                  <td>{formatNumber(cacheMissTokens(row))}</td>
                  <td>{formatNumber(row.output_tokens)}</td>
                  <td>{formatNumber(row.reasoning_tokens)}</td>
                  <td>{formatNumber(row.total_tokens)}</td>
                  <td>{formatMoney(row.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function APIKeyQuotaDetailPanel({
  detail,
  loading,
  error,
  onClose,
}: {
  detail: UsageAnalyticsAPIKeyDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const quota = detail?.quotas?.[0];
  const key = detail?.key;
  const displayLabel = key?.display_label || key?.api_key_name || key?.api_key_fingerprint || '-';

  return (
    <section className={`${styles.panel} ${styles.fullPanel}`}>
      <div className={styles.quotaPanelHeader}>
        <div>
          <h3>API Key Quotas</h3>
          <p>
            {displayLabel}
            {key?.api_key_fingerprint && displayLabel !== key.api_key_fingerprint
              ? ` · ${key.api_key_fingerprint}`
              : ''}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {loading ? (
        <div className={styles.emptyState}>Loading API key quota...</div>
      ) : error ? (
        <div className={styles.errorBox}>{error}</div>
      ) : !quota ? (
        <div className={styles.emptyState}>No quota policy returned for this API key.</div>
      ) : (
        <>
          <div className={styles.quotaMeta}>
            <span>{formatQuotaPeriod(quota.period)}</span>
            <span>{quota.period_key || '-'}</span>
            <span>{formatNumber(quota.requests)} requests</span>
            {!quota.store_available && <strong>Quota store unavailable</strong>}
            {quota.blocked && <strong>Blocked by quota</strong>}
          </div>
          <div className={styles.quotaGrid}>
            <div className={quota.token_quota?.exceeded ? styles.quotaExceeded : ''}>
              <span>Token quota</span>
              <strong>{formatTokenQuotaMetric(quota.token_quota)}</strong>
              <small>Remaining {formatQuotaRemaining(quota.token_quota, 'tokens')}</small>
            </div>
            <div className={quota.usd_quota?.exceeded ? styles.quotaExceeded : ''}>
              <span>USD quota</span>
              <strong>{formatUSDQuotaMetric(quota.usd_quota)}</strong>
              <small>Remaining {formatQuotaRemaining(quota.usd_quota, 'usd')}</small>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function TopDrivers({
  snapshot,
  onSelect,
}: {
  snapshot: UsageAnalyticsSnapshot | null;
  onSelect: (kind: DriverKind, label: string) => void;
}) {
  const rows = topDriverRows(snapshot);
  return (
    <section className={styles.panel}>
      <div className={styles.panelTitleRow}>
        <h3>Top Usage Drivers</h3>
        <span>Cost first</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyState}>No drivers in this period</div>
      ) : (
        <div className={styles.driverList}>
          {rows.map((item) => (
            <button
              key={`${item.kind}-${item.filterValue}`}
              type="button"
              onClick={() => onSelect(item.kind, item.filterValue)}
            >
              <span>
                <strong>{item.label}</strong>
                <small>
                  {item.typeLabel}
                  {item.secondary ? ` · ${item.secondary}` : ''}
                </small>
              </span>
              <span>
                <strong>{formatMoney(item.cost)}</strong>
                <small>{formatCompact(item.tokens)} tokens</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function UsageChart({
  snapshot,
  period,
  metric,
  breakdown,
  tokenBudget,
  onMetricChange,
  onBreakdownChange,
  onBudgetChange,
  onBucketSelect,
  onExport,
}: {
  snapshot: UsageAnalyticsSnapshot | null;
  period: UsageAnalyticsPeriod;
  metric: ChartMetric;
  breakdown: ChartBreakdown;
  tokenBudget: string;
  onMetricChange: (metric: ChartMetric) => void;
  onBreakdownChange: (breakdown: ChartBreakdown) => void;
  onBudgetChange: (value: string) => void;
  onBucketSelect: (selection: ChartBucketSelection) => void;
  onExport: () => void;
}) {
  const series = snapshot?.series || [];
  const budgetValue = Math.max(0, toNumber(tokenBudget));
  const values = series.map((point) => metricValue(point, metric));
  const maxValue = Math.max(1, ...values, metric === 'tokens' ? budgetValue : 0);
  const yTicks = [1, 0.75, 0.5, 0.25, 0];
  const points: ChartPointView[] = series.map((point, index) => {
    const value = metricValue(point, metric);
    return {
      point,
      label: point.label || point.date || `Bucket ${index + 1}`,
      value,
      range: bucketRange(point, index, period),
      segments: chartSegments(point, metric, breakdown),
    };
  });
  const budgetPercent =
    budgetValue > 0 ? Math.max(0, Math.min(100, 100 - (budgetValue / maxValue) * 100)) : 0;

  return (
    <section className={`${styles.panel} ${styles.fullPanel}`}>
      <div className={styles.chartHeader}>
        <div>
          <h3>Usage Control Chart</h3>
          <p>Click a bucket to inspect matching requests.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onExport}>
          <IconDownload size={15} />
          Export CSV
        </Button>
      </div>
      <div className={styles.chartControls}>
        <div className={styles.segmentGroup} role="group" aria-label="Chart metric">
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={metric === option.value ? styles.active : ''}
              aria-pressed={metric === option.value}
              onClick={() => onMetricChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.segmentGroup} role="group" aria-label="Token breakdown">
          {BREAKDOWN_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={breakdown === option.value ? styles.active : ''}
              aria-pressed={breakdown === option.value}
              disabled={metric !== 'tokens'}
              onClick={() => onBreakdownChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className={styles.budgetInput}>
          Daily budget
          <input
            inputMode="numeric"
            aria-label="Daily token budget"
            value={tokenBudget}
            placeholder="tokens"
            onChange={(event) => onBudgetChange(event.target.value.replace(/[^0-9.]/g, ''))}
          />
        </label>
      </div>
      {series.length === 0 ? (
        <div className={styles.emptyState}>No usage in this period</div>
      ) : (
        <>
          <div className={styles.chartShell}>
            <div className={styles.yAxis} aria-hidden="true">
              {yTicks.map((tick) => (
                <span key={tick}>{formatMetricValue(maxValue * tick, metric, true)}</span>
              ))}
            </div>
            <div className={styles.plotArea}>
              {yTicks.map((tick) => (
                <span
                  key={tick}
                  className={styles.gridLine}
                  style={{ top: `${(1 - tick) * 100}%` }}
                />
              ))}
              {metric === 'tokens' && budgetValue > 0 && (
                <span className={styles.budgetLine} style={{ top: `${budgetPercent}%` }}>
                  <em>{formatCompact(budgetValue)} budget</em>
                </span>
              )}
              <div className={styles.bars}>
                {points.map((item) => {
                  const totalHeight = Math.max(
                    item.value > 0 ? 3 : 0,
                    (item.value / maxValue) * 100
                  );
                  const summary = `${formatMetricValue(item.value, metric)} · ${formatNumber(item.point.requests)} requests · ${formatMoney(item.point.cost_usd)}`;
                  return (
                    <button
                      key={`${item.label}-${item.range.start || item.point.date || ''}`}
                      type="button"
                      className={styles.chartBucket}
                      onClick={() => onBucketSelect({ ...item.range, summary })}
                      aria-label={`${item.label}: ${summary}. Click to filter request details.`}
                    >
                      <span className={styles.tooltip} role="tooltip">
                        <strong>{item.label}</strong>
                        <span>{formatMetricValue(item.value, metric)}</span>
                        <span>{formatNumber(item.point.requests)} requests</span>
                        <span>{formatMoney(item.point.cost_usd)}</span>
                      </span>
                      <span className={styles.stackedBar} style={{ height: `${totalHeight}%` }}>
                        {item.segments.map((segment) => (
                          <i
                            key={segment.key}
                            className={segment.className}
                            style={{ flexGrow: item.value > 0 ? segment.value / item.value : 0 }}
                            title={`${segment.label}: ${formatMetricValue(segment.value, 'tokens')}`}
                          />
                        ))}
                      </span>
                      <small>{item.label}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className={styles.chartLegend}>
            {chartSegments(
              {
                tokens: 1,
                breakdown: {
                  input_tokens: 1,
                  output_tokens: 1,
                  cached_tokens: 1,
                  total_tokens: 2,
                },
              },
              'tokens',
              metric === 'tokens' ? breakdown : 'total'
            ).map((segment) => (
              <span key={segment.key}>
                <i className={segment.className} />
                {segment.label}
              </span>
            ))}
          </div>
          <div className={styles.tableScroller}>
            <table className={styles.srDataTable} aria-label="Usage chart data table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Requests</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cached</th>
                  <th>Miss</th>
                  <th>Reasoning</th>
                  <th>Total</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point, index) => (
                  <tr key={`${point.label || point.date || index}-table`}>
                    <td>{point.label || point.date || `Bucket ${index + 1}`}</td>
                    <td>{formatNumber(point.requests)}</td>
                    <td>{formatNumber(point.breakdown?.input_tokens)}</td>
                    <td>{formatNumber(point.breakdown?.output_tokens)}</td>
                    <td>{formatNumber(point.breakdown?.cached_tokens)}</td>
                    <td>{formatNumber(cacheMissTokens(point.breakdown))}</td>
                    <td>{formatNumber(point.breakdown?.reasoning_tokens)}</td>
                    <td>{formatNumber(point.tokens || point.breakdown?.total_tokens)}</td>
                    <td>{formatMoney(point.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function RecentRequests({ rows }: { rows?: UsageRecentRequest[] }) {
  const visibleRows = (rows || []).slice(0, 20);

  return (
    <section className={`${styles.panel} ${styles.fullPanel}`}>
      <h3>Recent Requests</h3>
      {visibleRows.length === 0 ? (
        <div className={styles.emptyState}>No recent requests</div>
      ) : (
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Provider</th>
                <th>Model</th>
                <th>API Key</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${row.time || index}-${index}`}>
                  <td>{formatDateTime(row.time)}</td>
                  <td>{row.provider || '-'}</td>
                  <td>{row.model || '-'}</td>
                  <td>
                    <APIKeyIdentityLabel value={row} />
                  </td>
                  <td>
                    <span
                      className={`${styles.statusPill} ${row.failed ? styles.failed : styles.ok}`}
                    >
                      {row.failed ? 'failed' : 'ok'}
                    </span>
                  </td>
                  <td>{formatNumber(row.total_tokens)}</td>
                  <td>{formatMoney(row.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DetailsTable({
  details,
  loading,
  onPageChange,
}: {
  details: UsageRequestDetailsSnapshot | null;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const rows = details?.details || [];
  const pagination = details?.pagination || {};

  return (
    <section className={`${styles.panel} ${styles.fullPanel}`}>
      <div className={styles.panelTitleRow}>
        <h3>Request Details</h3>
        {loading && <span>Loading...</span>}
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyState}>No matching details</div>
      ) : (
        <div className={styles.tableScroller}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Provider</th>
                <th>Model</th>
                <th>API Key</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Latency</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id || `${row.timestamp}-${index}`}>
                  <td>{formatDateTime(row.timestamp)}</td>
                  <td>{row.provider || '-'}</td>
                  <td>{row.model || '-'}</td>
                  <td>
                    <APIKeyIdentityLabel value={row} />
                  </td>
                  <td>
                    <span
                      className={`${styles.statusPill} ${row.failed ? styles.failed : styles.ok}`}
                    >
                      {row.status || (row.failed ? 'failed' : 'success')}
                    </span>
                  </td>
                  <td>{formatNumber(row.tokens?.total_tokens)}</td>
                  <td>{formatNumber(row.latency?.total)} ms</td>
                  <td>{formatMoney(row.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.pager}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!pagination.has_prev || loading}
          onClick={() => onPageChange(Math.max(1, toNumber(pagination.page) - 1))}
        >
          Prev
        </Button>
        <span>
          Page {formatNumber(pagination.page || 1)} of {formatNumber(pagination.total_pages || 0)} /{' '}
          {formatNumber(pagination.total_items || 0)} items
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!pagination.has_next || loading}
          onClick={() => onPageChange(toNumber(pagination.page || 1) + 1)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}

export function UsageAnalyticsPage() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [preferences, setPreferences] = useState<ChartPreferences>(readPreferences);
  const [tab, setTab] = useState<'overview' | 'details'>('overview');
  const [snapshot, setSnapshot] = useState<UsageAnalyticsSnapshot | null>(null);
  const [details, setDetails] = useState<UsageRequestDetailsSnapshot | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<UsageRequestDetailsParams>({});
  const [selectedAPIKeyID, setSelectedAPIKeyID] = useState('');
  const [apiKeyDetail, setAPIKeyDetail] = useState<UsageAnalyticsAPIKeyDetail | null>(null);
  const [apiKeyDetailLoading, setAPIKeyDetailLoading] = useState(false);
  const [apiKeyDetailError, setAPIKeyDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [streamError, setStreamError] = useState('');
  const dependentRefreshRef = useRef<() => void>(() => undefined);
  const dependentRefreshTimerRef = useRef<number | null>(null);

  const disabled = connectionStatus !== 'connected';
  const period = preferences.period;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preference persistence is best-effort only.
    }
  }, [preferences]);

  const updatePreferences = useCallback((patch: Partial<ChartPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const loadOverview = useCallback(
    async ({ notifySuccess = false }: { notifySuccess?: boolean } = {}) => {
      if (disabled) {
        setSnapshot(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await usageAnalyticsApi.getStats(period);
        setSnapshot(data);
        if (notifySuccess) showNotification('Usage analytics refreshed', 'success');
      } catch (err: unknown) {
        setError(errorMessage(err, 'Unable to load usage analytics'));
      } finally {
        setLoading(false);
      }
    },
    [disabled, period, showNotification]
  );

  const loadDetails = useCallback(
    async (nextPage = page) => {
      if (disabled) {
        setDetails(null);
        return;
      }
      setDetailsLoading(true);
      setError('');
      try {
        setDetails(
          await usageAnalyticsApi.getRequestDetails({
            ...filters,
            page: nextPage,
            pageSize: 25,
          })
        );
      } catch (err: unknown) {
        setError(errorMessage(err, 'Unable to load request details'));
      } finally {
        setDetailsLoading(false);
      }
    },
    [disabled, filters, page]
  );

  const loadAPIKeyDetail = useCallback(
    async (id: string) => {
      const trimmed = id.trim();
      if (disabled || !trimmed) {
        setAPIKeyDetail(null);
        return;
      }
      setAPIKeyDetailLoading(true);
      setAPIKeyDetailError('');
      try {
        setAPIKeyDetail(await usageAnalyticsApi.getApiKeyDetail(trimmed, period));
      } catch (err: unknown) {
        setAPIKeyDetail(null);
        setAPIKeyDetailError(errorMessage(err, 'Unable to load API key quota detail'));
      } finally {
        setAPIKeyDetailLoading(false);
      }
    },
    [disabled, period]
  );

  const refresh = useCallback(async () => {
    await loadOverview({ notifySuccess: true });
    if (tab === 'details') {
      await loadDetails(page);
    }
    if (selectedAPIKeyID) {
      await loadAPIKeyDetail(selectedAPIKeyID);
    }
  }, [loadAPIKeyDetail, loadDetails, loadOverview, page, selectedAPIKeyID, tab]);

  useHeaderRefresh(refresh);

  useEffect(() => {
    dependentRefreshRef.current = () => {
      if (tab === 'details') {
        void loadDetails(page);
      }
      if (selectedAPIKeyID) {
        void loadAPIKeyDetail(selectedAPIKeyID);
      }
    };
  }, [loadAPIKeyDetail, loadDetails, page, selectedAPIKeyID, tab]);

  const scheduleDependentRefresh = useCallback(() => {
    if (dependentRefreshTimerRef.current !== null) {
      window.clearTimeout(dependentRefreshTimerRef.current);
    }
    dependentRefreshTimerRef.current = window.setTimeout(() => {
      dependentRefreshTimerRef.current = null;
      dependentRefreshRef.current();
    }, 250);
  }, []);

  useEffect(
    () => () => {
      if (dependentRefreshTimerRef.current !== null) {
        window.clearTimeout(dependentRefreshTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (disabled || !apiBase || !managementKey) {
      setStreamStatus('idle');
      setStreamError('');
      return;
    }

    let stopped = false;
    let retryTimer: number | null = null;
    let controller: AbortController | null = null;

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      setStreamStatus('connecting');
      setStreamError('');
      try {
        await usageAnalyticsApi.streamStats(period, {
          apiBase,
          managementKey,
          signal: controller.signal,
          onSnapshot: (nextSnapshot) => {
            setSnapshot(nextSnapshot);
            setLoading(false);
            setError('');
            setStreamStatus('connected');
            setStreamError('');
            scheduleDependentRefresh();
          },
        });
        if (!stopped) {
          setStreamStatus('error');
          setStreamError('Realtime stream disconnected.');
          retryTimer = window.setTimeout(connect, 3000);
        }
      } catch (err: unknown) {
        if (stopped || isAbortLikeError(err)) return;
        setStreamStatus('error');
        setStreamError(errorMessage(err, 'Realtime stream failed.'));
        retryTimer = window.setTimeout(connect, 3000);
      }
    };

    void connect();

    return () => {
      stopped = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      controller?.abort();
    };
  }, [apiBase, disabled, managementKey, period, scheduleDependentRefresh]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (tab === 'details') {
      void loadDetails(page);
    }
  }, [loadDetails, page, tab]);

  useEffect(() => {
    if (selectedAPIKeyID) {
      void loadAPIKeyDetail(selectedAPIKeyID);
    } else {
      setAPIKeyDetail(null);
      setAPIKeyDetailError('');
    }
  }, [loadAPIKeyDetail, selectedAPIKeyID]);

  const totals = snapshot?.totals;
  const tokens = totals?.tokens;
  const success = toNumber(totals?.success);
  const failed = toNumber(totals?.failed);
  const requests = toNumber(totals?.requests);
  const cost = toNumber(totals?.cost_usd);
  const totalTokens = toNumber(tokens?.total_tokens);
  const tokenBudget = toNumber(preferences.tokenBudget);
  const budgetUsed = tokenBudget > 0 ? (totalTokens / tokenBudget) * 100 : 0;
  const cacheRatio = totalTokens > 0 ? (toNumber(tokens?.cached_tokens) / totalTokens) * 100 : 0;
  const cacheMiss = cacheMissTokens(tokens);
  const errorRate = requests > 0 ? (failed / requests) * 100 : 0;
  const detailsTotals = details?.totals;
  const detailsTokens = detailsTotals?.tokens;
  const streamBadgeClass =
    streamStatus === 'connected'
      ? styles.liveConnected
      : streamStatus === 'connecting'
        ? styles.liveConnecting
        : streamStatus === 'error'
          ? styles.liveError
          : styles.liveIdle;
  const streamTitle = streamError || streamStatusCopy[streamStatus];

  const selectedMetricLabel =
    METRIC_OPTIONS.find((option) => option.value === preferences.metric)?.label || 'Usage';
  const previousComparison = useMemo(() => {
    const current =
      preferences.metric === 'cost'
        ? toNumber(snapshot?.totals?.cost_usd)
        : preferences.metric === 'requests'
          ? toNumber(snapshot?.totals?.requests)
          : toNumber(snapshot?.totals?.tokens?.total_tokens);
    const previous =
      preferences.metric === 'cost'
        ? toNumber(snapshot?.previous_totals?.cost_usd)
        : preferences.metric === 'requests'
          ? toNumber(snapshot?.previous_totals?.requests)
          : toNumber(snapshot?.previous_totals?.tokens?.total_tokens);
    if (previous <= 0 && current <= 0)
      return { value: '-', hint: `No ${selectedMetricLabel.toLowerCase()} trend yet` };
    if (previous <= 0) return { value: 'New', hint: `${selectedMetricLabel} vs previous period` };
    const delta = ((current - previous) / previous) * 100;
    return {
      value: `${delta >= 0 ? '+' : ''}${formatPercent(delta)}`,
      hint: `${selectedMetricLabel} vs previous period`,
    };
  }, [preferences.metric, selectedMetricLabel, snapshot?.previous_totals, snapshot?.totals]);

  const forecast = useMemo(() => {
    if (!snapshot?.series?.length || totalTokens <= 0) return 'No forecast yet';
    const elapsedBuckets =
      snapshot.series.filter((point) => metricValue(point, 'tokens') > 0).length || 1;
    const projected = (totalTokens / elapsedBuckets) * snapshot.series.length;
    if (tokenBudget > 0)
      return `${formatCompact(projected)} projected / ${formatCompact(tokenBudget)} budget`;
    return `${formatCompact(projected)} projected for selected period`;
  }, [snapshot?.series, tokenBudget, totalTokens]);

  const filterInputs = useMemo(
    () =>
      [
        ['provider', 'Provider'],
        ['model', 'Model'],
        ['apiKey', 'API Key'],
        ['endpoint', 'Endpoint'],
      ] as const,
    []
  );

  const applyDriverFilter = useCallback(
    (kind: DriverKind, label: string) => {
      const patch: UsageRequestDetailsParams = {};
      if (kind === 'provider') patch.provider = label;
      if (kind === 'model') patch.model = label;
      if (kind === 'apiKey') patch.apiKey = label;
      if (kind === 'endpoint') patch.endpoint = label;
      if (kind === 'account')
        showNotification(
          'Account grouping is shown in overview; request details can be narrowed by provider, model, API key, endpoint, status, or bucket time.',
          'info'
        );
      setFilters((current) => ({ ...current, ...patch }));
      setPage(1);
      setTab('details');
    },
    [showNotification]
  );

  const applyBucketFilter = useCallback(
    (range: ChartBucketSelection) => {
      if (!range.start || !range.end) return;
      setFilters((current) => ({ ...current, start: range.start, end: range.end }));
      setPage(1);
      setTab('details');
      showNotification(`Filtered ${range.label}: ${range.summary}`, 'info');
    },
    [showNotification]
  );

  const exportCSV = useCallback(() => {
    const rows = snapshot?.series || [];
    const csv = [
      [
        'bucket',
        'requests',
        'input_tokens',
        'output_tokens',
        'cached_tokens',
        'cache_miss_tokens',
        'reasoning_tokens',
        'total_tokens',
        'cost_usd',
      ],
      ...rows.map((point) => [
        point.label || point.date || '',
        point.requests || 0,
        point.breakdown?.input_tokens || 0,
        point.breakdown?.output_tokens || 0,
        point.breakdown?.cached_tokens || 0,
        cacheMissTokens(point.breakdown),
        point.breakdown?.reasoning_tokens || 0,
        point.tokens || point.breakdown?.total_tokens || 0,
        point.cost_usd || 0,
      ]),
    ]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `usage-analytics-${snapshot?.period || period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [period, snapshot?.period, snapshot?.series]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1>Usage & Analytics</h1>
          <p>Request volume, token flow, provider activity, and captured request details.</p>
        </div>
        <div className={styles.headerActions}>
          <span
            className={`${styles.liveBadge} ${streamBadgeClass}`}
            title={streamTitle}
            aria-live="polite"
          >
            <span aria-hidden="true" />
            {streamStatusCopy[streamStatus]}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            loading={loading || detailsLoading}
            disabled={disabled}
          >
            <IconRefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.segmentGroup} role="tablist" aria-label="Usage period">
          {PERIODS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={period === entry.value ? styles.active : ''}
              aria-pressed={period === entry.value}
              onClick={() => {
                updatePreferences({ period: entry.value });
                setPage(1);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className={styles.segmentGroup} role="tablist" aria-label="Usage tab">
          <button
            type="button"
            className={tab === 'overview' ? styles.active : ''}
            aria-pressed={tab === 'overview'}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={tab === 'details' ? styles.active : ''}
            aria-pressed={tab === 'details'}
            onClick={() => setTab('details')}
          >
            Details
          </button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}
      {snapshot && !snapshot.usage_statistics_enabled && (
        <div className={styles.warningBox}>
          Usage statistics are currently disabled. Enable usage-statistics-enabled to collect live
          request details.
        </div>
      )}

      {loading ? (
        <div className={styles.loadingState}>Loading usage analytics...</div>
      ) : tab === 'overview' ? (
        <>
          <div className={styles.statsGrid}>
            <StatCard
              label="Requests"
              value={formatNumber(requests)}
              hint={`${formatNumber(success)} ok / ${formatNumber(failed)} failed`}
            />
            <StatCard label="Total Tokens" value={formatNumber(totalTokens)} hint={forecast} />
            <StatCard
              label="Estimated Cost"
              value={formatMoney(cost)}
              hint={`${formatNumber(cacheMiss)} miss / ${formatNumber(tokens?.cached_tokens)} cached / ${formatNumber(tokens?.output_tokens)} output`}
            />
            <StatCard
              label="Cache Ratio"
              value={formatPercent(cacheRatio)}
              hint={`${formatNumber(tokens?.cached_tokens)} hit / ${formatNumber(cacheMiss)} miss`}
            />
            <StatCard
              label="Error Rate"
              value={formatPercent(errorRate)}
              hint={`${formatNumber(failed)} failed requests`}
            />
            <StatCard
              label="Budget Used"
              value={tokenBudget > 0 ? formatPercent(budgetUsed) : '-'}
              hint={
                tokenBudget > 0 ? `${formatNumber(tokenBudget)} token budget` : 'Set a daily budget'
              }
            />
            <StatCard
              label="Previous Period"
              value={previousComparison.value}
              hint={previousComparison.hint}
            />
          </div>
          <div className={styles.controlGrid}>
            <UsageChart
              snapshot={snapshot}
              period={period}
              metric={preferences.metric}
              breakdown={preferences.breakdown}
              tokenBudget={preferences.tokenBudget}
              onMetricChange={(metric) => updatePreferences({ metric })}
              onBreakdownChange={(breakdown) => updatePreferences({ breakdown })}
              onBudgetChange={(tokenBudget) => updatePreferences({ tokenBudget })}
              onBucketSelect={applyBucketFilter}
              onExport={exportCSV}
            />
            <TopDrivers snapshot={snapshot} onSelect={applyDriverFilter} />
          </div>
          <div className={styles.groupGrid}>
            <GroupTable title="By Provider" rows={snapshot?.by_provider} labelField="provider" />
            <GroupTable title="By Model" rows={snapshot?.by_model} labelField="model" />
            <GroupTable title="By Account" rows={snapshot?.by_account} labelField="account_label" />
            <GroupTable
              title="By API Key"
              rows={snapshot?.by_api_key}
              labelField="api_key_label"
              apiKeyIdentityColumn
              onApiKeySelect={setSelectedAPIKeyID}
            />
          </div>
          {selectedAPIKeyID && (
            <APIKeyQuotaDetailPanel
              detail={apiKeyDetail}
              loading={apiKeyDetailLoading}
              error={apiKeyDetailError}
              onClose={() => setSelectedAPIKeyID('')}
            />
          )}
          <RecentRequests rows={snapshot?.recent_requests} />
        </>
      ) : (
        <>
          <div className={styles.filters}>
            {filterInputs.map(([key, label]) => (
              <input
                key={key}
                value={String(filters[key] || '')}
                placeholder={label}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, [key]: event.target.value }));
                  setPage(1);
                }}
              />
            ))}
            <input
              value={filters.start || ''}
              placeholder="Start ISO time"
              onChange={(event) => {
                setFilters((current) => ({ ...current, start: event.target.value }));
                setPage(1);
              }}
            />
            <input
              value={filters.end || ''}
              placeholder="End ISO time"
              onChange={(event) => {
                setFilters((current) => ({ ...current, end: event.target.value }));
                setPage(1);
              }}
            />
            <select
              value={filters.status || ''}
              onChange={(event) => {
                setFilters((current) => ({ ...current, status: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">Any status</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPage(1);
                void loadDetails(1);
              }}
              loading={detailsLoading}
            >
              Apply
            </Button>
          </div>
          <div className={styles.statsGrid}>
            <StatCard
              label="Requests"
              value={formatNumber(detailsTotals?.requests)}
              hint={`${formatNumber(detailsTotals?.success)} ok / ${formatNumber(detailsTotals?.failed)} failed`}
            />
            <StatCard
              label="Input Tokens"
              value={formatNumber(detailsTokens?.input_tokens)}
              hint={`${formatNumber(detailsTokens?.cached_tokens)} cached`}
            />
            <StatCard
              label="Output Tokens"
              value={formatNumber(detailsTokens?.output_tokens)}
              hint={`${formatNumber(detailsTokens?.reasoning_tokens)} reasoning`}
            />
            <StatCard
              label="Total Tokens"
              value={formatNumber(detailsTokens?.total_tokens)}
              hint="filtered details"
            />
            <StatCard
              label="Estimated Cost"
              value={formatMoney(detailsTotals?.cost_usd)}
              hint="filtered details"
            />
          </div>
          <DetailsTable details={details} loading={detailsLoading} onPageChange={setPage} />
        </>
      )}

      <div className={styles.footerHint}>
        <IconChartLine size={15} />
        Data comes from management usage analytics endpoints.
      </div>
    </div>
  );
}
