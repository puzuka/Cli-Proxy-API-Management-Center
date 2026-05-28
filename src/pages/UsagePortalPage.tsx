import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  IconChartLine,
  IconCopy,
  IconDollarSign,
  IconEye,
  IconInfo,
  IconKey,
  IconRefreshCw,
  IconSearch,
  IconShield,
  IconTimer,
  IconTrendingUp,
  IconX,
} from '@/components/ui/icons';
import { usagePortalApi } from '@/services/usagePortal';
import type {
  UsageDailyPoint,
  UsageRecentRequest,
  UsageSnapshot,
  UsageTokenTotals,
  UsageWindow,
} from '@/types/usagePortal';
import styles from './UsagePortalPage.module.scss';

const USAGE_WINDOWS: Array<{ label: string; value: UsageWindow; helper: string }> = [
  { label: 'Today', value: '1d', helper: 'Current day' },
  { label: '7D', value: '7d', helper: 'Last 7 days' },
  { label: '30D', value: '30d', helper: 'Last 30 days' },
  { label: '60D', value: '60d', helper: 'Retention limit' },
];

const DEFAULT_TOKENS: UsageTokenTotals = {
  input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  cached_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 0,
};

const EMPTY_SERIES: UsageDailyPoint[] = [];
const EMPTY_RECENT_REQUESTS: UsageRecentRequest[] = [];

const numberFormatter = new Intl.NumberFormat();

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
});

const moneyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const preciseMoneyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const getPathApiKey = () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const usageIndex = parts.indexOf('usage');
  if (usageIndex === -1 || parts.length <= usageIndex + 1) return '';

  try {
    return decodeURIComponent(parts[usageIndex + 1]);
  } catch {
    return parts[usageIndex + 1];
  }
};

const getSearchWindow = (): UsageWindow => {
  const rawWindow = new URLSearchParams(window.location.search).get('window');
  return USAGE_WINDOWS.some((entry) => entry.value === rawWindow) ? (rawWindow as UsageWindow) : '7d';
};

const normalizeKeyInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed, window.location.origin);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const usageIndex = parts.indexOf('usage');
    if (usageIndex !== -1 && parts.length > usageIndex + 1) {
      return decodeURIComponent(parts[usageIndex + 1]);
    }
  } catch {
    return trimmed;
  }

  return trimmed;
};

const usagePath = (apiKey: string, windowValue: UsageWindow) =>
  apiKey
    ? `/usage/${encodeURIComponent(apiKey)}?window=${encodeURIComponent(windowValue)}`
    : `/usage?window=${encodeURIComponent(windowValue)}`;

const formatNumber = (value?: number) => numberFormatter.format(value || 0);

const formatCompact = (value?: number) => compactFormatter.format(value || 0);

const formatMoney = (value?: number, precise = false) =>
  precise ? preciseMoneyFormatter.format(value || 0) : moneyFormatter.format(value || 0);

const formatPercent = (value?: number) => percentFormatter.format(value || 0);

const formatDateTime = (value?: string) => {
  if (!value) return 'Not loaded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not loaded';
  return date.toLocaleString();
};

const formatShortDate = (value: string) => {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
};

const formatDuration = (value?: number) => {
  const ms = value || 0;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${formatNumber(ms)}ms`;
};

const clampRatio = (value: number) => Math.max(0, Math.min(1, value));

const statusTone = (failed: number, requests: number) => {
  if (!requests) return styles.neutralTone;
  const rate = failed / requests;
  if (rate >= 0.1) return styles.warningTone;
  if (rate > 0) return styles.cautionTone;
  return styles.successTone;
};

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const element = document.createElement('textarea');
  element.value = value;
  element.setAttribute('readonly', 'true');
  element.style.position = 'fixed';
  element.style.opacity = '0';
  document.body.appendChild(element);
  element.select();
  document.execCommand('copy');
  document.body.removeChild(element);
};

function StatCard({
  label,
  value,
  sublabel,
  icon,
  toneClass = '',
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: ReactNode;
  toneClass?: string;
}) {
  return (
    <article className={`${styles.statCard} ${toneClass}`}>
      <div className={styles.statIcon}>{icon}</div>
      <div>
        <div className={styles.statLabel}>{label}</div>
        <div className={styles.statValue}>{value}</div>
      </div>
      <div className={styles.statSubLabel}>{sublabel}</div>
    </article>
  );
}

function InsightCard({
  label,
  value,
  detail,
  icon,
  toneClass = '',
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  toneClass?: string;
}) {
  return (
    <article className={`${styles.insightCard} ${toneClass}`}>
      <div className={styles.insightIcon}>{icon}</div>
      <div>
        <div className={styles.insightLabel}>{label}</div>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function TokenBreakdown({ tokens }: { tokens: UsageTokenTotals }) {
  const rows = [
    { label: 'Input', value: tokens.input_tokens, helper: 'Prompt and context tokens' },
    { label: 'Cached input', value: tokens.cached_tokens, helper: 'Reused context within input' },
    { label: 'Output', value: tokens.output_tokens, helper: 'Generated response tokens' },
    { label: 'Reasoning', value: tokens.reasoning_tokens, helper: 'Internal reasoning tokens' },
  ];
  const maxValue = Math.max(1, ...rows.map((row) => row.value || 0));

  return (
    <section className={styles.panel} aria-labelledby="token-breakdown-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="token-breakdown-title">Token breakdown</h2>
          <p>Shows where the selected range is spending tokens.</p>
        </div>
      </div>
      <div className={styles.breakdownList}>
        {rows.map((row) => (
          <div key={row.label} className={styles.breakdownRow}>
            <div className={styles.breakdownMeta}>
              <strong>{row.label}</strong>
              <span>{row.helper}</span>
            </div>
            <div className={styles.breakdownTrack} aria-hidden="true">
              <span style={{ width: `${clampRatio((row.value || 0) / maxValue) * 100}%` }} />
            </div>
            <div className={styles.breakdownValue}>{formatCompact(row.value)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UsageChart({ series, windowValue }: { series: UsageDailyPoint[]; windowValue: UsageWindow }) {
  const width = 900;
  const height = 280;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 44;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const isHourly = windowValue === '1d' && series.length === 24;
  const values = series.map((point) => point.tokens?.total_tokens || 0);
  const max = Math.max(1, ...values);
  const hasData = values.some((value) => value > 0);
  const step = series.length > 1 ? plotWidth / (series.length - 1) : 0;
  const hourSlotWidth = isHourly && series.length ? plotWidth / series.length : 0;
  const hourBarWidth = isHourly ? Math.max(8, Math.min(22, hourSlotWidth * 0.62)) : 0;
  const points = values.map((value, index) => {
    const x = isHourly
      ? padLeft + hourSlotWidth * index + hourSlotWidth / 2
      : series.length > 1
        ? padLeft + step * index
        : padLeft + plotWidth / 2;
    const y = padTop + plotHeight - (value / max) * plotHeight;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area =
    !isHourly && points.length > 1
      ? `${padLeft},${padTop + plotHeight} ${line} ${width - padRight},${padTop + plotHeight}`
      : '';
  const labelStep = series.length > 12 ? Math.ceil(series.length / 8) : 1;
  const yTicks = [max, max / 2, 0];
  const singleBarWidth = Math.min(128, plotWidth * 0.38);

  return (
    <div className={styles.chartBox}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${isHourly ? 'Hourly' : 'Daily'} token trend. Peak ${formatNumber(max)} tokens.`}
      >
        <title>{isHourly ? 'Hourly token trend' : 'Daily token trend'}</title>
        <defs>
          <linearGradient id="usagePortalFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <g className={styles.chartGrid}>
          {yTicks.map((tick) => {
            const y = padTop + plotHeight - (tick / max) * plotHeight;
            return (
              <g key={tick}>
                <line x1={padLeft} y1={y} x2={width - padRight} y2={y} />
                <text x={12} y={y + 4} className={styles.chartYAxis}>
                  {formatCompact(tick)}
                </text>
              </g>
            );
          })}
        </g>
        {isHourly &&
          points.map(([x, y], index) => (
            <rect
              key={`${series[index]?.date || series[index]?.label}-${index}`}
              x={x - hourBarWidth / 2}
              y={y}
              width={hourBarWidth}
              height={padTop + plotHeight - y}
              rx="5"
              className={styles.chartBar}
            >
              <title>
                {series[index]?.label || formatShortDate(series[index]?.date || '')}: {formatNumber(values[index])} tokens
              </title>
            </rect>
          ))}
        {!isHourly && series.length === 1 && hasData && (
          <rect
            x={padLeft + plotWidth / 2 - singleBarWidth / 2}
            y={points[0][1]}
            width={singleBarWidth}
            height={padTop + plotHeight - points[0][1]}
            rx="8"
            className={styles.chartBar}
          />
        )}
        {area && <polygon points={area} className={styles.chartArea} />}
        {!isHourly && line && series.length > 1 && <polyline points={line} className={styles.chartLine} />}
        {!isHourly && points.map(([x, y], index) => (
          <circle key={`${series[index]?.date}-${index}`} cx={x} cy={y} r="4" className={styles.chartDot} />
        ))}
        {series.map((point, index) => {
          if (isHourly && index % 3 !== 0 && index !== series.length - 1) {
            return null;
          }
          if (!isHourly && series.length > 12 && index % labelStep !== 0 && index !== series.length - 1) {
            return null;
          }
          const x = isHourly
            ? padLeft + hourSlotWidth * index + hourSlotWidth / 2
            : series.length > 1
              ? padLeft + step * index
              : padLeft + plotWidth / 2;
          return (
            <text key={`${point.date}-${point.label || index}`} x={x} y={height - 12} textAnchor="middle" className={styles.chartLabel}>
              {point.label || formatShortDate(point.date)}
            </text>
          );
        })}
      </svg>
      {!hasData && <div className={styles.chartEmpty}>No token activity in this range.</div>}
    </div>
  );
}

function RecentRows({ rows }: { rows: UsageRecentRequest[] }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'failed'>('all');

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === 'ok' && row.failed) return false;
      if (statusFilter === 'failed' && !row.failed) return false;
      if (!normalizedQuery) return true;

      return [
        row.provider,
        row.model,
        row.alias,
        row.endpoint,
        row.request_id,
        row.account_label,
        row.auth_type,
        String(row.status_code || ''),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [query, rows, statusFilter]);

  const failedRows = rows.filter((row) => row.failed).length;
  const okRows = rows.length - failedRows;

  if (!rows.length) {
    return <div className={styles.emptyState}>No usage records for this range yet.</div>;
  }

  return (
    <div className={styles.recentSection}>
      <div className={styles.tableTools}>
        <label className={styles.searchBox}>
          <IconSearch size={16} />
          <span className={styles.srOnly}>Search recent requests</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search provider, model, account, request ID"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear request search">
              <IconX size={16} />
            </button>
          )}
        </label>

        <div className={styles.statusFilter} role="group" aria-label="Request status filter">
          {[
            { label: 'All', value: 'all', count: rows.length },
            { label: 'OK', value: 'ok', count: okRows },
            { label: 'Failed', value: 'failed', count: failedRows },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={statusFilter === option.value ? styles.activeFilter : ''}
              aria-pressed={statusFilter === option.value}
              onClick={() => setStatusFilter(option.value as 'all' | 'ok' | 'failed')}
            >
              {option.label}
              <span>{formatNumber(option.count)}</span>
            </button>
          ))}
        </div>
      </div>

      {!filteredRows.length ? (
        <div className={styles.emptyState}>No recent requests match this filter.</div>
      ) : (
        <>
          <div className={styles.requestCards} aria-label="Recent requests cards">
            {filteredRows.map((row, index) => (
              <article key={`${row.time}-${row.request_id || index}`} className={styles.requestCard}>
                <div className={styles.requestCardTop}>
                  <div>
                    <strong>{row.alias || row.model || '-'}</strong>
                    <span>{row.provider || '-'} · {row.endpoint || '-'}</span>
                  </div>
                  <span className={`${styles.statusPill} ${row.failed ? styles.failed : styles.ok}`}>
                    {row.failed ? row.status_code || 'error' : row.status_code || 'ok'}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Time</dt>
                    <dd>{formatDateTime(row.time)}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>{formatCompact(row.total_tokens)}</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{formatMoney(row.cost_usd, true)}</dd>
                  </div>
                  <div>
                    <dt>Latency</dt>
                    <dd>{formatDuration(row.latency_ms)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Account</th>
                  <th>Endpoint</th>
                  <th>Effort</th>
                  <th>Tokens</th>
                  <th>Cache</th>
                  <th>Cost</th>
                  <th>Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr key={`${row.time}-${row.request_id || index}`}>
                    <td>{formatDateTime(row.time)}</td>
                    <td className={styles.monoCell}>{row.provider || '-'}</td>
                    <td className={styles.monoCell}>
                      <span>{row.alias || row.model || '-'}</span>
                      {row.alias && row.model && row.alias !== row.model && <small>{row.model}</small>}
                    </td>
                    <td className={styles.accountCell}>{row.account_label || row.auth_type || '-'}</td>
                    <td>{row.endpoint || '-'}</td>
                    <td>{row.reasoning_effort || '-'}</td>
                    <td className={styles.numericCell}>
                      <span>{formatNumber(row.total_tokens)}</span>
                      <small>{formatNumber(row.input_tokens)} in / {formatNumber(row.output_tokens)} out</small>
                    </td>
                    <td className={styles.numericCell}>
                      <span>{formatNumber(row.cached_tokens)}</span>
                      <small>{formatNumber(row.reasoning_tokens)} reasoning</small>
                    </td>
                    <td className={styles.numericCell}>{formatMoney(row.cost_usd, true)}</td>
                    <td className={styles.numericCell}>{formatDuration(row.latency_ms)}</td>
                    <td>
                      <span className={`${styles.statusPill} ${row.failed ? styles.failed : styles.ok}`}>
                        {row.failed ? row.status_code || 'error' : row.status_code || 'ok'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <>
      <section className={styles.statsGrid} aria-label="Loading usage summary">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={`${styles.statCard} ${styles.skeletonCard}`} />
        ))}
      </section>
      <section className={`${styles.panel} ${styles.skeletonPanel}`} />
      <section className={`${styles.panel} ${styles.skeletonPanel}`} />
    </>
  );
}

export function UsagePortalPage() {
  const [apiKey, setApiKey] = useState(getPathApiKey);
  const [inputValue, setInputValue] = useState('');
  const [windowValue, setWindowValue] = useState<UsageWindow>(getSearchWindow);
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  const activeKey = apiKey.trim();
  const totals = snapshot?.totals;
  const tokens = totals?.tokens || DEFAULT_TOKENS;
  const series = snapshot?.series || EMPTY_SERIES;
  const recentRequests = snapshot?.recent_requests || EMPTY_RECENT_REQUESTS;
  const windowMeta = USAGE_WINDOWS.find((entry) => entry.value === windowValue) || USAGE_WINDOWS[1];
  const errorRate = totals?.requests ? totals.failed / totals.requests : 0;
  const cacheRate = tokens.input_tokens ? clampRatio(tokens.cached_tokens / tokens.input_tokens) : 0;
  const averageLatency = useMemo(() => {
    if (!recentRequests.length) return 0;
    return recentRequests.reduce((sum, row) => sum + (row.latency_ms || 0), 0) / recentRequests.length;
  }, [recentRequests]);

  const requestSubLabel = useMemo(() => {
    if (!totals) return 'Successful and failed requests';
    return `${formatNumber(totals.success)} ok, ${formatNumber(totals.failed)} failed`;
  }, [totals]);

  const loadSnapshot = useCallback(async () => {
    if (!activeKey) return;

    setLoading(true);
    setError('');

    try {
      const data = await usagePortalApi.getSnapshot(activeKey, windowValue);
      setSnapshot(data);
    } catch (err) {
      setSnapshot(null);
      setError(err instanceof Error ? err.message : 'Unable to load usage for this API key.');
    } finally {
      setLoading(false);
    }
  }, [activeKey, windowValue]);

  useEffect(() => {
    const handlePopState = () => {
      setApiKey(getPathApiKey());
      setWindowValue(getSearchWindow());
      setInputValue('');
      setError('');
      setCopyStatus('');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!activeKey) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    loadSnapshot();
  }, [activeKey, loadSnapshot]);

  useEffect(() => {
    if (!copyStatus) return;
    const timeout = window.setTimeout(() => setCopyStatus(''), 2400);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const openKey = useCallback(
    (nextKey: string) => {
      const normalized = normalizeKeyInput(nextKey);
      if (!normalized) {
        setError('Enter an API key or a /usage/... link.');
        return;
      }

      window.history.pushState({}, '', usagePath(normalized, windowValue));
      setApiKey(normalized);
      setInputValue('');
      setError('');
      setCopyStatus('');
    },
    [windowValue]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    openKey(inputValue);
  };

  const selectWindow = (nextWindow: UsageWindow) => {
    setWindowValue(nextWindow);
    window.history.replaceState({}, '', usagePath(activeKey, nextWindow));
    setCopyStatus('');
  };

  const showOtherKey = () => {
    window.history.pushState({}, '', usagePath('', windowValue));
    setApiKey('');
    setSnapshot(null);
    setInputValue('');
    setError('');
    setCopyStatus('');
  };

  const copyCurrentLink = async () => {
    try {
      await copyText(window.location.href);
      setCopyStatus('Usage link copied.');
    } catch {
      setCopyStatus('Copy failed.');
    }
  };

  if (!activeKey) {
    return (
      <main className={styles.loginShell}>
        <section className={styles.loginPanel}>
          <div className={styles.loginIcon} aria-hidden="true">
            <IconChartLine size={26} />
          </div>
          <h1>Usage Portal</h1>
          <p>Enter your proxy API key to view token usage, request volume, cost, and recent activity.</p>

          <form className={styles.keyForm} onSubmit={handleSubmit}>
            <label htmlFor="usage-api-key">API key or usage link</label>
            <input
              id="usage-api-key"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              placeholder="Paste API key or /usage/... link"
              aria-describedby="usage-api-key-help"
            />
            <div id="usage-api-key-help" className={styles.fieldHelp}>
              This checks usage only for the provided key. It does not require the management secret.
            </div>
            <Button type="submit" fullWidth disabled={!inputValue.trim()}>
              <IconEye size={18} />
              View Usage
            </Button>
          </form>

          {error && (
            <div className={styles.errorBox} role="alert">
              <IconInfo size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className={styles.hintBox}>Read-only portal. Request payloads and secrets are not shown here.</div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.portalShell} aria-busy={loading}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>Read-only usage portal</span>
              <span className={`${styles.badge} ${snapshot?.active === false ? styles.badgeWarning : styles.badgeOk}`}>
                {snapshot?.active === false ? 'Inactive key' : 'Active key'}
              </span>
              <span
                className={`${styles.badge} ${
                  snapshot?.usage_statistics_enabled === false ? styles.badgeWarning : styles.badgeOk
                }`}
              >
                {snapshot?.usage_statistics_enabled === false ? 'Stats disabled' : 'Stats enabled'}
              </span>
              {snapshot && <span className={styles.badge}>{snapshot.retention_days} day retention</span>}
            </div>
            <h1>{snapshot?.key_label || 'API key'}</h1>
            <p>Token usage, request health, cost, and sanitized request activity for this API key.</p>
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={copyCurrentLink}>
              <IconCopy size={16} />
              Copy Link
            </Button>
            <Button variant="secondary" size="sm" onClick={loadSnapshot} loading={loading}>
              <IconRefreshCw size={16} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={showOtherKey}>
              <IconKey size={16} />
              Other Key
            </Button>
          </div>
        </div>

        <div className={styles.metaRow}>
          <div>
            <div className={styles.updatedText}>Last updated {formatDateTime(snapshot?.updated_at)}</div>
            <div className={styles.copyStatus} aria-live="polite">
              {copyStatus || `${windowMeta.helper}, ${snapshot?.window_days || windowValue.replace('d', '')} day window`}
            </div>
          </div>
          <div className={styles.windowTabs} role="tablist" aria-label="Usage range">
            {USAGE_WINDOWS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={entry.value === windowValue}
                className={entry.value === windowValue ? styles.activeWindow : ''}
                onClick={() => selectWindow(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className={styles.errorBox} role="alert">
          <IconInfo size={16} />
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={loadSnapshot}>
            Retry
          </Button>
        </div>
      )}

      {loading && !snapshot ? (
        <LoadingState />
      ) : (
        <>
          <section className={styles.statsGrid} aria-label="Usage summary">
            <StatCard
              label="Tokens"
              value={formatCompact(tokens.total_tokens)}
              sublabel="Total tokens in selected range"
              icon={<IconTrendingUp size={22} />}
            />
            <StatCard
              label="Requests"
              value={formatNumber(totals?.requests)}
              sublabel={requestSubLabel}
              icon={<IconShield size={22} />}
              toneClass={statusTone(totals?.failed || 0, totals?.requests || 0)}
            />
            <StatCard
              label="Cost"
              value={formatMoney(totals?.cost_usd)}
              sublabel="Estimated usage cost"
              icon={<IconDollarSign size={22} />}
            />
            <StatCard
              label="Errors"
              value={formatNumber(totals?.failed)}
              sublabel={`${formatPercent(errorRate)} of requests failed`}
              icon={<IconChartLine size={22} />}
              toneClass={statusTone(totals?.failed || 0, totals?.requests || 0)}
            />
          </section>

          <section className={styles.insightGrid} aria-label="Usage quality signals">
            <InsightCard
              label="Cache efficiency"
              value={formatPercent(cacheRate)}
              detail={`${formatCompact(tokens.cached_tokens)} cached input tokens`}
              icon={<IconTimer size={18} />}
            />
            <InsightCard
              label="Average recent latency"
              value={formatDuration(averageLatency)}
              detail={`${formatNumber(recentRequests.length)} recent samples`}
              icon={<IconRefreshCw size={18} />}
              toneClass={averageLatency > 30_000 ? styles.warningTone : ''}
            />
            <InsightCard
              label="Successful requests"
              value={formatNumber(totals?.success)}
              detail={`${formatPercent(totals?.requests ? (totals.success || 0) / totals.requests : 0)} success rate`}
              icon={<IconShield size={18} />}
              toneClass={statusTone(totals?.failed || 0, totals?.requests || 0)}
            />
          </section>

          <section className={styles.panel} aria-labelledby="usage-chart-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="usage-chart-title">Usage chart</h2>
                <p>
                  {windowValue === '1d'
                    ? 'Hourly token usage for today. Each bar represents one hour.'
                    : 'Daily token trend for this key. Switch the range to compare longer periods.'}
                </p>
              </div>
            </div>
            <UsageChart series={series} windowValue={windowValue} />
          </section>

          <TokenBreakdown tokens={tokens} />

          <section className={styles.panel} aria-labelledby="recent-requests-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="recent-requests-title">Recent requests</h2>
                <p>Sanitized request metadata for this API key. Payloads and secrets stay hidden.</p>
              </div>
            </div>
            <RecentRows rows={recentRequests} />
          </section>
        </>
      )}
    </main>
  );
}
