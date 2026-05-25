import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  IconChartLine,
  IconEye,
  IconKey,
  IconRefreshCw,
  IconShield,
  IconTimer,
  IconTrendingUp,
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

const USAGE_WINDOWS: Array<{ label: string; value: UsageWindow }> = [
  { label: 'Today', value: '1d' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '60D', value: '60d' },
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

const numberFormatter = new Intl.NumberFormat();

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
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

const formatDateTime = (value?: string) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
};

const formatShortDate = (value: string) => {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
};

function StatCard({
  label,
  value,
  sublabel,
  icon,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ReactNode;
}) {
  return (
    <article className={styles.statCard}>
      <div className={styles.statIcon}>{icon}</div>
      <div>
        <div className={styles.statLabel}>{label}</div>
        <div className={styles.statValue}>{value}</div>
      </div>
      <div className={styles.statSubLabel}>{sublabel}</div>
    </article>
  );
}

function UsageChart({ series }: { series: UsageDailyPoint[] }) {
  const width = 900;
  const height = 260;
  const pad = 30;
  const values = series.map((point) => point.tokens?.total_tokens || 0);
  const max = Math.max(1, ...values);
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = pad + step * index;
    const y = height - pad - (value / max) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const area = points.length
    ? `${pad},${height - pad} ${line} ${width - pad},${height - pad}`
    : '';
  const labelStep = series.length > 12 ? Math.ceil(series.length / 8) : 1;

  return (
    <div className={styles.chartBox}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        <title>Daily token trend</title>
        <defs>
          <linearGradient id="usagePortalFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className={styles.chartGrid}>
          <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
          <line x1={pad} y1={pad} x2={pad} y2={height - pad} />
        </g>
        {area && <polygon points={area} className={styles.chartArea} />}
        {line && <polyline points={line} className={styles.chartLine} />}
        {series.map((point, index) => {
          if (series.length > 12 && index % labelStep !== 0 && index !== series.length - 1) {
            return null;
          }
          return (
            <text
              key={point.date}
              x={pad + step * index}
              y={height - 8}
              textAnchor="middle"
              className={styles.chartLabel}
            >
              {formatShortDate(point.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function RecentRows({ rows }: { rows: UsageRecentRequest[] }) {
  if (!rows.length) {
    return <div className={styles.emptyState}>No usage records for this range yet.</div>;
  }

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Endpoint</th>
            <th>Input</th>
            <th>Cache</th>
            <th>Output</th>
            <th>Total</th>
            <th>Latency</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.time}-${row.request_id || index}`}>
              <td>{formatDateTime(row.time)}</td>
              <td className={styles.monoCell}>{row.provider || '-'}</td>
              <td className={styles.monoCell}>{row.model || '-'}</td>
              <td>{row.endpoint || '-'}</td>
              <td className={styles.numericCell}>{formatNumber(row.input_tokens)}</td>
              <td className={styles.numericCell}>{formatNumber(row.cached_tokens)}</td>
              <td className={styles.numericCell}>{formatNumber(row.output_tokens)}</td>
              <td className={styles.numericCell}>{formatNumber(row.total_tokens)}</td>
              <td className={styles.numericCell}>{formatNumber(row.latency_ms)}ms</td>
              <td>
                <span className={`${styles.statusPill} ${row.failed ? styles.failed : styles.ok}`}>
                  {row.failed ? row.status_code || 'error' : 'ok'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsagePortalPage() {
  const [apiKey, setApiKey] = useState(getPathApiKey);
  const [inputValue, setInputValue] = useState('');
  const [windowValue, setWindowValue] = useState<UsageWindow>(getSearchWindow);
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const activeKey = apiKey.trim();
  const totals = snapshot?.totals;
  const tokens = totals?.tokens || DEFAULT_TOKENS;

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
  };

  const showOtherKey = () => {
    window.history.pushState({}, '', usagePath('', windowValue));
    setApiKey('');
    setSnapshot(null);
    setInputValue('');
    setError('');
  };

  if (!activeKey) {
    return (
      <main className={styles.loginShell}>
        <section className={styles.loginPanel}>
          <div className={styles.loginIcon} aria-hidden="true">
            <IconChartLine size={26} />
          </div>
          <h1>Usage Portal</h1>
          <p>Enter your proxy API key to view token usage, request volume, and recent activity.</p>

          <form className={styles.keyForm} onSubmit={handleSubmit}>
            <label htmlFor="usage-api-key">API key</label>
            <input
              id="usage-api-key"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste API key or /usage/... link"
            />
            <Button type="submit" fullWidth>
              <IconEye size={18} />
              View Usage
            </Button>
          </form>

          {error && <div className={styles.errorBox}>{error}</div>}
          <div className={styles.hintBox}>
            This page is read-only and does not use the management key.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.portalShell}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>Read-only usage portal</span>
              <span className={`${styles.badge} ${snapshot?.active ? styles.badgeOk : ''}`}>
                {snapshot?.active === false ? 'Inactive' : 'Active'}
              </span>
              <span className={styles.badge}>
                {snapshot?.usage_statistics_enabled === false ? 'Stats disabled' : 'Stats enabled'}
              </span>
            </div>
            <h1>{snapshot?.key_label || 'API key'}</h1>
            <p>Token usage, request volume, and sanitized request activity for this API key.</p>
          </div>

          <div className={styles.actions}>
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
          <div className={styles.updatedText}>Last updated {formatDateTime(snapshot?.updated_at)}</div>
          <div className={styles.windowTabs} role="tablist" aria-label="Usage range">
            {USAGE_WINDOWS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={entry.value === windowValue ? styles.activeWindow : ''}
                onClick={() => selectWindow(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className={styles.errorBox}>{error}</div>}

      <section className={styles.statsGrid}>
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
        />
        <StatCard
          label="Cache"
          value={formatCompact(tokens.cached_tokens)}
          sublabel="Cached tokens"
          icon={<IconTimer size={22} />}
        />
        <StatCard
          label="Errors"
          value={formatNumber(totals?.failed)}
          sublabel={
            snapshot?.usage_statistics_enabled === false
              ? 'Enable usage-statistics-enabled'
              : 'Failed requests'
          }
          icon={<IconChartLine size={22} />}
        />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Usage chart</h2>
            <p>Daily token trend for this key.</p>
          </div>
        </div>
        <UsageChart series={snapshot?.series || []} />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Recent requests</h2>
            <p>Sanitized request metadata for this API key.</p>
          </div>
        </div>
        <RecentRows rows={snapshot?.recent_requests || []} />
      </section>
    </main>
  );
}
