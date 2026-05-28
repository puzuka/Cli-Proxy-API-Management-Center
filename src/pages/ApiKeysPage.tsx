import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  IconChartLine,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconKey,
  IconMoreHorizontal,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconShield,
  IconSlidersHorizontal,
  IconTimer,
  IconTrash2,
  IconTrendingUp,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  apiKeysApi,
  usageAnalyticsApi,
  type ApiKeyItem,
  type ApiKeyMetadata,
  type UsageAnalyticsSnapshot,
  type UsageRequestDetail,
} from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

type ModalMode =
  | { type: 'add' }
  | { type: 'edit'; index: number }
  | { type: 'rotate'; index: number; nextKey: string };
type StatusFilter = 'all' | 'active' | 'used' | 'idle' | 'risk' | 'errors' | 'blocked';
type KeyRowStatus =
  | 'active'
  | 'used'
  | 'idle'
  | 'attention'
  | 'disabled'
  | 'expired'
  | 'revoked'
  | 'invalid'
  | 'blocked';
type SortOption = 'risk' | 'last-used' | 'cost' | 'requests' | 'tokens' | 'name' | 'status';
type RiskTone = 'danger' | 'warning' | 'neutral';

interface RiskBadge {
  label: string;
  tone: RiskTone;
  title: string;
}

interface ApiKeyFormState {
  key: string;
  name: string;
  owner: string;
  environment: string;
  description: string;
  tags: string;
  scopes: string;
  allowedProviders: string;
  allowedModels: string;
  ipAllowlist: string;
  expiresAt: string;
  disabled: boolean;
  quotaPeriod: 'daily' | 'one_time';
  tokenQuotaLimit: string;
  usdQuotaLimit: string;
}

interface ApiKeyRow {
  index: number;
  id: string;
  key: string;
  name: string;
  fingerprint: string;
  analyticsLabel: string;
  owner: string;
  hasOwner: boolean;
  environment: string;
  scope: string;
  quota: string;
  budget: string;
  quotaPeriod: string;
  tokenQuotaLimit: number;
  tokenQuotaUsed: number;
  tokenQuotaRemaining: number;
  usdQuotaLimit: number;
  usdQuotaUsed: number;
  usdQuotaRemaining: number;
  blockedByQuota: boolean;
  allowedProviders: string;
  allowedModels: string;
  ipAllowlist: string;
  description: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  lastRotatedAt?: string;
  disabledAt?: string;
  revokedAt?: string;
  audit: NonNullable<ApiKeyMetadata['audit']>;
  policyStatus: ApiKeyItem['status'];
  policyReason?: string;
  status: KeyRowStatus;
  statusLabel: string;
  requests: number;
  success: number;
  failed: number;
  errorRate: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  lastUsed?: string;
  topProvider: string;
  topModel: string;
  endpoint: string;
  recentRequests: UsageRequestDetail[];
  riskBadges: RiskBadge[];
  riskScore: number;
}

const numberFormatter = new Intl.NumberFormat();
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const moneyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dayMs = 24 * 60 * 60 * 1000;
const highSpendUsd = 5;
const expiresSoonDays = 14;

const timestampMs = (value?: string): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

const formatNumber = (value: unknown) => numberFormatter.format(toNumber(value));
const formatCompactNumber = (value: unknown) => compactNumberFormatter.format(toNumber(value));
const formatMoney = (value: unknown) => moneyFormatter.format(toNumber(value));

const formatQuotaPeriod = (value?: string) => (value === 'daily' ? 'Daily reset' : 'One-time');

const validExpiryValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/.test(trimmed)) {
    return !Number.isNaN(new Date(trimmed.replace(' ', 'T')).getTime());
  }
  return false;
};

const emptyFormState: ApiKeyFormState = {
  key: '',
  name: '',
  owner: '',
  environment: '',
  description: '',
  tags: '',
  scopes: '',
  allowedProviders: '',
  allowedModels: '',
  ipAllowlist: '',
  expiresAt: '',
  disabled: false,
  quotaPeriod: 'one_time',
  tokenQuotaLimit: '',
  usdQuotaLimit: '',
};

const parseList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const joinList = (value?: string[]) => (value?.length ? value.join(', ') : '');

const formatList = (value?: string[], fallback = 'All') =>
  value?.length ? value.join(', ') : fallback;

const metadataToForm = (item?: ApiKeyItem): ApiKeyFormState => {
  const metadata = item?.metadata || {};
  return {
    key: item?.key || '',
    name: metadata.name || '',
    owner: metadata.owner || '',
    environment: metadata.environment || '',
    description: metadata.description || '',
    tags: joinList(metadata.tags),
    scopes: joinList(metadata.scopes),
    allowedProviders: joinList(metadata.allowedProviders),
    allowedModels: joinList(metadata.allowedModels),
    ipAllowlist: joinList(metadata.ipAllowlist),
    expiresAt: metadata.expiresAt || '',
    disabled: Boolean(metadata.disabled),
    quotaPeriod: metadata.quotaPeriod === 'daily' ? 'daily' : 'one_time',
    tokenQuotaLimit: metadata.tokenQuotaLimit ? String(metadata.tokenQuotaLimit) : '',
    usdQuotaLimit: metadata.usdQuotaLimit ? String(metadata.usdQuotaLimit) : '',
  };
};

const formToMetadata = (form: ApiKeyFormState, existing: ApiKeyMetadata = {}): ApiKeyMetadata => ({
  ...existing,
  name: form.name.trim() || undefined,
  owner: form.owner.trim() || undefined,
  environment: form.environment.trim() || undefined,
  description: form.description.trim() || undefined,
  tags: parseList(form.tags),
  scopes: parseList(form.scopes),
  allowedProviders: parseList(form.allowedProviders),
  allowedModels: parseList(form.allowedModels),
  ipAllowlist: parseList(form.ipAllowlist),
  expiresAt: form.expiresAt.trim() || undefined,
  disabled: form.disabled,
  quotaPeriod: form.quotaPeriod,
  tokenQuotaLimit: form.tokenQuotaLimit.trim() ? Number(form.tokenQuotaLimit) : undefined,
  usdQuotaLimit: form.usdQuotaLimit.trim() ? Number(form.usdQuotaLimit) : undefined,
});

const generateSecureApiKey = (): string => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  return `sk-${Array.from(bytes, (byte) => charset[byte % charset.length]).join('')}`;
};

const usageAnalyticsKeyLabel = (apiKey: string) => {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return '****';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const buildUsageLink = (apiKey: string) => {
  if (typeof window === 'undefined') return `/usage/${encodeURIComponent(apiKey)}`;
  return `${window.location.origin}/usage/${encodeURIComponent(apiKey)}`;
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const formatRelativeTime = (value?: string) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'Just now';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });

const compareRows = (left: ApiKeyRow, right: ApiKeyRow, sortBy: SortOption) => {
  const tieBreak = compareText(left.name, right.name);
  switch (sortBy) {
    case 'risk':
      return right.riskScore - left.riskScore || right.failed - left.failed || tieBreak;
    case 'last-used':
      return (timestampMs(right.lastUsed) || 0) - (timestampMs(left.lastUsed) || 0) || tieBreak;
    case 'cost':
      return right.costUsd - left.costUsd || tieBreak;
    case 'requests':
      return right.requests - left.requests || tieBreak;
    case 'tokens':
      return right.totalTokens - left.totalTokens || tieBreak;
    case 'status':
      return compareText(left.statusLabel, right.statusLabel) || tieBreak;
    case 'name':
    default:
      return tieBreak;
  }
};

const requestTime = (request?: UsageRequestDetail) => request?.timestamp || '';

const groupMatchesKey = (key: string, value?: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  return (
    normalized === key ||
    normalized === usageAnalyticsKeyLabel(key) ||
    normalized === maskApiKey(key)
  );
};

const createKeyRows = (
  items: ApiKeyItem[],
  analytics: UsageAnalyticsSnapshot | null,
  details: UsageRequestDetail[]
): ApiKeyRow[] => {
  return items.map((item, index) => {
    const key = item.key;
    const metadata = item.metadata || {};
    const group = analytics?.by_api_key?.find((entry) =>
      [entry.key, entry.api_key_label].some((value) => groupMatchesKey(key, value))
    );
    const recentRequests = details.filter((request) => groupMatchesKey(key, request.api_key_label));
    const latest = recentRequests[0];
    const requests = toNumber(group?.requests || recentRequests.length);
    const failed = toNumber(
      group?.failed || recentRequests.filter((request) => request.failed).length
    );
    const success = toNumber(
      group?.success ||
        Math.max(0, requests - failed || recentRequests.filter((request) => !request.failed).length)
    );
    const errorRate = requests > 0 ? (failed / requests) * 100 : 0;
    const quotaStatus = item.quotaStatus;
    const tokenQuotaLimit = toNumber(metadata.tokenQuotaLimit);
    const usdQuotaLimit = toNumber(metadata.usdQuotaLimit);
    const tokenQuotaUsed = toNumber(quotaStatus?.tokenQuota?.used);
    const tokenQuotaRemaining = toNumber(quotaStatus?.tokenQuota?.remaining);
    const usdQuotaUsed = toNumber(quotaStatus?.usdQuota?.used);
    const usdQuotaRemaining = toNumber(quotaStatus?.usdQuota?.remaining);
    const blockedByQuota = Boolean(quotaStatus?.blocked);
    const policyStatus = String(item.status || 'active');
    const blockedStatus = ['disabled', 'expired', 'revoked', 'invalid'].includes(policyStatus)
      ? (policyStatus as KeyRowStatus)
      : null;
    const status: KeyRowStatus =
      blockedStatus || (blockedByQuota ? 'blocked' : failed > 0 ? 'attention' : requests > 0 ? 'used' : 'idle');
    const lastUsed = group?.last_used || requestTime(latest);
    const inputTokens = toNumber(group?.input_tokens);
    const outputTokens = toNumber(group?.output_tokens);
    const totalTokens =
      toNumber(group?.total_tokens) ||
      recentRequests.reduce((total, request) => total + toNumber(request.tokens?.total_tokens), 0);
    const costUsd =
      toNumber(group?.cost_usd) ||
      recentRequests.reduce((total, request) => total + toNumber(request.cost_usd), 0);
    const owner = metadata.owner?.trim();
    const environment = metadata.environment?.trim();
    const expiresAtMs = timestampMs(metadata.expiresAt);
    const lastUsedMs = timestampMs(lastUsed);
    const now = Date.now();
    const unused30d = !lastUsedMs || now - lastUsedMs >= 30 * dayMs;
    const expiresSoon =
      Boolean(expiresAtMs) && expiresAtMs! > now && expiresAtMs! - now <= expiresSoonDays * dayMs;
    const highSpend =
      costUsd >= highSpendUsd ||
      Boolean(usdQuotaLimit && usdQuotaUsed >= usdQuotaLimit * 0.8);
    const riskBadges: RiskBadge[] = [
      !owner
        ? {
            label: 'No owner',
            tone: 'warning',
            title: 'No owner or team is assigned to this credential.',
          }
        : null,
      unused30d
        ? {
            label: 'Unused 30d',
            tone: 'neutral',
            title: 'No captured usage in the last 30 days or usage has never been captured.',
          }
        : null,
      highSpend
        ? {
            label: 'High spend',
            tone: 'danger',
            title: `Estimated cost is at least ${formatMoney(highSpendUsd)} or near the configured budget.`,
          }
        : null,
      blockedByQuota
        ? {
            label: 'Blocked by quota',
            tone: 'danger',
            title: 'Token or USD quota is exhausted.',
          }
        : null,
      expiresSoon
        ? {
            label: 'Expires soon',
            tone: 'warning',
            title: `Expiration is within ${expiresSoonDays} days.`,
          }
        : null,
    ].filter((badge): badge is RiskBadge => Boolean(badge));
    const riskScore =
      (highSpend ? 50 : 0) +
      (failed > 0 ? 35 : 0) +
      (blockedByQuota ? 60 : 0) +
      (!owner ? 25 : 0) +
      (expiresSoon ? 20 : 0) +
      (unused30d ? 10 : 0) +
      (['disabled', 'expired', 'revoked', 'invalid', 'blocked'].includes(status) ? 8 : 0);

    return {
      index,
      id: item.id,
      key,
      name: metadata.name || `API Key #${index + 1}`,
      fingerprint: item.maskedKey || maskApiKey(key),
      analyticsLabel: usageAnalyticsKeyLabel(key),
      owner: owner || 'Unassigned',
      hasOwner: Boolean(owner),
      environment: environment || 'Default',
      scope: formatList(metadata.scopes, 'All proxy scopes'),
      quota: tokenQuotaLimit
        ? `${formatCompactNumber(tokenQuotaUsed)} / ${formatCompactNumber(tokenQuotaLimit)} tokens`
        : 'Proxy-wide token rules',
      budget: usdQuotaLimit
        ? `${formatMoney(usdQuotaUsed)} / ${formatMoney(usdQuotaLimit)}`
        : 'Not configured',
      quotaPeriod: formatQuotaPeriod(quotaStatus?.period || metadata.quotaPeriod),
      tokenQuotaLimit,
      tokenQuotaUsed,
      tokenQuotaRemaining,
      usdQuotaLimit,
      usdQuotaUsed,
      usdQuotaRemaining,
      blockedByQuota,
      allowedProviders: formatList(metadata.allowedProviders, 'All configured providers'),
      allowedModels: formatList(metadata.allowedModels, 'All configured models'),
      ipAllowlist: formatList(metadata.ipAllowlist, 'All source IPs'),
      description: metadata.description || 'No description',
      tags: metadata.tags || [],
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      expiresAt: metadata.expiresAt,
      lastRotatedAt: metadata.lastRotatedAt,
      disabledAt: metadata.disabledAt,
      revokedAt: metadata.revokedAt,
      audit: metadata.audit || [],
      policyStatus: item.status,
      policyReason: item.statusReason,
      status,
      statusLabel:
        status === 'revoked'
          ? 'Revoked'
          : status === 'disabled'
            ? 'Disabled'
            : status === 'expired'
              ? 'Expired'
              : status === 'invalid'
                ? 'Invalid policy'
                : status === 'blocked'
                  ? 'Blocked by quota'
                  : status === 'attention'
                    ? 'Needs attention'
                    : status === 'used'
                      ? 'Used today'
                      : 'No usage today',
      requests,
      success,
      failed,
      errorRate,
      inputTokens,
      outputTokens,
      cachedTokens: toNumber(group?.cached_tokens),
      totalTokens,
      costUsd,
      lastUsed,
      topProvider: latest?.provider || group?.provider || '-',
      topModel: latest?.model || group?.model || '-',
      endpoint: latest?.endpoint || group?.endpoint || '-',
      recentRequests,
      riskBadges,
      riskScore,
    };
  });
};

function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'good' | 'warning';
  icon: React.ReactNode;
}) {
  return (
    <div className={`${styles.metricCard} ${styles[tone]}`}>
      <span className={styles.metricIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function TokenSplit({ row }: { row: ApiKeyRow }) {
  if (
    row.totalTokens <= 0 &&
    row.inputTokens <= 0 &&
    row.cachedTokens <= 0 &&
    row.outputTokens <= 0
  ) {
    return (
      <div
        className={`${styles.tokenSplit} ${styles.emptyTokenSplit}`}
        aria-label="No token usage"
      />
    );
  }

  const total = Math.max(row.inputTokens + row.cachedTokens + row.outputTokens, row.totalTokens, 1);
  const inputWidth = Math.max(4, (row.inputTokens / total) * 100);
  const cachedWidth = row.cachedTokens > 0 ? Math.max(4, (row.cachedTokens / total) * 100) : 0;
  const outputWidth = Math.max(4, (row.outputTokens / total) * 100);

  return (
    <div className={styles.tokenSplit} aria-label="Token split">
      <span className={styles.inputTokens} style={{ width: `${inputWidth}%` }} />
      {cachedWidth > 0 && (
        <span className={styles.cachedTokens} style={{ width: `${cachedWidth}%` }} />
      )}
      <span className={styles.outputTokens} style={{ width: `${outputWidth}%` }} />
    </div>
  );
}

export function ApiKeysPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [apiKeyItems, setApiKeyItems] = useState<ApiKeyItem[]>([]);
  const [analytics, setAnalytics] = useState<UsageAnalyticsSnapshot | null>(null);
  const [requestDetails, setRequestDetails] = useState<UsageRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [usageError, setUsageError] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [formState, setFormState] = useState<ApiKeyFormState>(emptyFormState);
  const [formError, setFormError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('risk');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());

  const disabled = connectionStatus !== 'connected';
  const modalOpen = modalMode !== null;
  const editingIndex = modalMode?.type === 'edit' ? modalMode.index : -1;
  const rotateIndex = modalMode?.type === 'rotate' ? modalMode.index : -1;
  const usageStatisticsEnabled =
    analytics?.usage_statistics_enabled ??
    Boolean(config?.raw?.['usage-statistics-enabled'] ?? config?.raw?.usageStatisticsEnabled);
  const apiKeys = useMemo(() => apiKeyItems.map((item) => item.key), [apiKeyItems]);

  const syncConfigStore = useCallback(async () => {
    const store = useConfigStore.getState();
    store.clearCache();
    try {
      await store.fetchConfig(undefined, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    }
  }, [showNotification, t]);

  const loadKeys = useCallback(
    async ({ notifySuccess = false }: { notifySuccess?: boolean } = {}) => {
      if (connectionStatus !== 'connected') {
        setApiKeyItems([]);
        setAnalytics(null);
        setRequestDetails([]);
        setSelectedRows(new Set());
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      setUsageError('');
      try {
        const [keysResult, analyticsResult, detailsResult] = await Promise.allSettled([
          apiKeysApi.listDetailed(),
          usageAnalyticsApi.getStats('today'),
          usageAnalyticsApi.getRequestDetails({ page: 1, pageSize: 100 }),
        ]);

        if (keysResult.status === 'rejected') {
          throw keysResult.reason;
        }

        setApiKeyItems(keysResult.value);

        if (analyticsResult.status === 'fulfilled') {
          setAnalytics(analyticsResult.value);
        } else {
          setAnalytics(null);
          setUsageError(
            analyticsResult.reason instanceof Error
              ? analyticsResult.reason.message
              : 'Usage analytics unavailable'
          );
        }

        if (detailsResult.status === 'fulfilled') {
          setRequestDetails(detailsResult.value.details || []);
        } else {
          setRequestDetails([]);
          setUsageError((current) => {
            const message =
              detailsResult.reason instanceof Error
                ? detailsResult.reason.message
                : 'Request details unavailable';
            return current ? `${current}; ${message}` : message;
          });
        }

        if (notifySuccess) {
          showNotification(t('notification.data_refreshed'), 'success');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('notification.refresh_failed');
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [connectionStatus, showNotification, t]
  );

  useHeaderRefresh(loadKeys);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const rows = useMemo(
    () => createKeyRows(apiKeyItems, analytics, requestDetails),
    [apiKeyItems, analytics, requestDetails]
  );

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedIndex(null);
      setSelectedRows(new Set());
      return;
    }
    if (selectedIndex === null || !rows.some((row) => row.index === selectedIndex)) {
      setSelectedIndex(rows[0].index);
    }
  }, [rows, selectedIndex]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const statusMatch =
        statusFilter === 'all' ||
        (statusFilter === 'active' &&
          !['disabled', 'expired', 'revoked', 'invalid', 'blocked'].includes(row.status)) ||
        (statusFilter === 'used' && row.requests > 0) ||
        (statusFilter === 'idle' && row.requests === 0) ||
        (statusFilter === 'risk' && (row.riskBadges.length > 0 || row.failed > 0)) ||
        (statusFilter === 'errors' && row.failed > 0) ||
        (statusFilter === 'blocked' &&
          ['disabled', 'expired', 'revoked', 'invalid', 'blocked'].includes(row.status));
      if (!statusMatch) return false;
      if (!query) return true;
      return [
        row.name,
        row.fingerprint,
        row.analyticsLabel,
        row.owner,
        row.environment,
        row.scope,
        row.allowedProviders,
        row.allowedModels,
        row.ipAllowlist,
        row.topProvider,
        row.topModel,
        row.endpoint,
        row.riskBadges.map((badge) => badge.label).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [rows, searchQuery, statusFilter]);

  const visibleRows = useMemo(
    () => [...filteredRows].sort((left, right) => compareRows(left, right, sortBy)),
    [filteredRows, sortBy]
  );

  const selectedRow = rows.find((row) => row.index === selectedIndex) || rows[0] || null;
  const selectedCount = selectedRows.size;
  const selectedRowsList = rows.filter((row) => selectedRows.has(row.index));

  const totals = useMemo(() => {
    const requests =
      toNumber(analytics?.totals?.requests) || rows.reduce((sum, row) => sum + row.requests, 0);
    const failed =
      toNumber(analytics?.totals?.failed) || rows.reduce((sum, row) => sum + row.failed, 0);
    const totalTokens =
      toNumber(analytics?.totals?.tokens?.total_tokens) ||
      rows.reduce((sum, row) => sum + row.totalTokens, 0);
    const costUsd =
      toNumber(analytics?.totals?.cost_usd) || rows.reduce((sum, row) => sum + row.costUsd, 0);
    return {
      requests,
      failed,
      totalTokens,
      costUsd,
      usedKeys: rows.filter((row) => row.requests > 0).length,
      attentionKeys: rows.filter(
        (row) =>
          row.failed > 0 ||
          ['disabled', 'expired', 'revoked', 'invalid', 'blocked'].includes(row.status)
      ).length,
    };
  }, [analytics, rows]);

  const duplicateKeyExists = useCallback(
    (value: string) =>
      apiKeys.some((key, index) => key === value && (editingIndex < 0 || index !== editingIndex)),
    [apiKeys, editingIndex]
  );

  const closeModal = useCallback(() => {
    setModalMode(null);
    setFormState(emptyFormState);
    setFormError('');
  }, []);

  const openAddModal = useCallback(() => {
    setModalMode({ type: 'add' });
    setFormState(emptyFormState);
    setFormError('');
  }, []);

  const openEditModal = useCallback(
    (index: number) => {
      setModalMode({ type: 'edit', index });
      setFormState(metadataToForm(apiKeyItems[index]));
      setFormError('');
    },
    [apiKeyItems]
  );

  const openRotateModal = useCallback((index: number) => {
    setModalMode({ type: 'rotate', index, nextKey: generateSecureApiKey() });
    setFormError('');
  }, []);

  const persistItems = useCallback(
    async (nextItems: Array<{ key: string; metadata: ApiKeyMetadata }>, successMessage: string) => {
      setSaving(true);
      setError('');
      try {
        await apiKeysApi.replaceDetailed(nextItems);
        setSelectedRows(new Set());
        await syncConfigStore();
        await loadKeys();
        showNotification(successMessage, 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('notification.save_failed');
        setError(message);
        showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [loadKeys, showNotification, syncConfigStore, t]
  );

  const handleSave = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmed = formState.key.trim();
      if (!trimmed) {
        setFormError(t('config_management.visual.api_keys.error_empty'));
        return;
      }
      if (!isValidApiKeyCharset(trimmed)) {
        setFormError(t('config_management.visual.api_keys.error_invalid'));
        return;
      }
      if (trimmed !== apiKeys[editingIndex] && duplicateKeyExists(trimmed)) {
        setFormError(
          t('api_keys.duplicate_error', { defaultValue: 'This API key already exists.' })
        );
        return;
      }
      if (!validExpiryValue(formState.expiresAt)) {
        setFormError('Expires at must be RFC3339 or local format like 2026-12-31T23:59.');
        return;
      }
      const tokenQuotaValue = Number(formState.tokenQuotaLimit);
      if (
        formState.tokenQuotaLimit.trim() &&
        (!Number.isFinite(tokenQuotaValue) || tokenQuotaValue < 0)
      ) {
        setFormError('Token quota must be 0 or greater.');
        return;
      }
      const usdQuotaValue = Number(formState.usdQuotaLimit);
      if (
        formState.usdQuotaLimit.trim() &&
        (!Number.isFinite(usdQuotaValue) || usdQuotaValue < 0)
      ) {
        setFormError('USD quota must be 0 or greater.');
        return;
      }

      const nextItems =
        editingIndex >= 0
          ? apiKeyItems.map((item, index) =>
              index === editingIndex
                ? {
                    key: trimmed,
                    metadata: formToMetadata(formState, item.metadata),
                  }
                : { key: item.key, metadata: item.metadata }
            )
          : [
              ...apiKeyItems.map((item) => ({ key: item.key, metadata: item.metadata })),
              { key: trimmed, metadata: formToMetadata(formState) },
            ];

      await persistItems(
        nextItems,
        editingIndex >= 0
          ? t('api_keys.update_success', { defaultValue: 'API key updated' })
          : t('api_keys.add_success', { defaultValue: 'API key added' })
      );
      closeModal();
    },
    [apiKeyItems, apiKeys, closeModal, duplicateKeyExists, editingIndex, formState, persistItems, t]
  );

  const handleRotate = useCallback(async () => {
    if (modalMode?.type !== 'rotate') return;
    const { index, nextKey } = modalMode;
    if (!apiKeys[index]) return;
    if (duplicateKeyExists(nextKey)) {
      setModalMode({ type: 'rotate', index, nextKey: generateSecureApiKey() });
      return;
    }
    const nextItems = apiKeyItems.map((item, keyIndex) => ({
      key: keyIndex === index ? nextKey : item.key,
      metadata: item.metadata,
    }));
    await persistItems(nextItems, 'API key rotated');
    await copyToClipboard(nextKey);
    closeModal();
  }, [apiKeyItems, apiKeys, closeModal, duplicateKeyExists, modalMode, persistItems]);

  const handleDeleteIndexes = useCallback(
    (indexes: number[]) => {
      const uniqueIndexes = Array.from(new Set(indexes)).filter((index) => apiKeys[index]);
      if (uniqueIndexes.length === 0) return;
      showConfirmation({
        title:
          uniqueIndexes.length === 1 ? 'Remove API key' : `Remove ${uniqueIndexes.length} API keys`,
        message: (
          <div className={styles.confirmBody}>
            <div>
              Removing keys revokes client access immediately. Usage history remains in analytics
              while retained by the server.
            </div>
            <div className={styles.confirmList}>
              {uniqueIndexes.map((index) => (
                <code key={apiKeys[index]}>{maskApiKey(apiKeys[index])}</code>
              ))}
            </div>
          </div>
        ),
        confirmText: 'Remove from config',
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: async () => {
          await persistItems(
            apiKeyItems
              .filter((_, keyIndex) => !uniqueIndexes.includes(keyIndex))
              .map((item) => ({ key: item.key, metadata: item.metadata })),
            uniqueIndexes.length === 1 ? 'API key removed' : 'API keys removed'
          );
        },
      });
    },
    [apiKeyItems, apiKeys, persistItems, showConfirmation, t]
  );

  const handleCopy = useCallback(
    async (apiKey: string) => {
      const copied = await copyToClipboard(apiKey);
      showNotification(
        copied ? 'Secret copied. Treat it as credential material.' : t('notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const persistRowMetadata = useCallback(
    async (
      index: number,
      updater: (metadata: ApiKeyMetadata) => ApiKeyMetadata,
      successMessage: string
    ) => {
      const nextItems = apiKeyItems.map((item, itemIndex) => ({
        key: item.key,
        metadata: itemIndex === index ? updater(item.metadata) : item.metadata,
      }));
      await persistItems(nextItems, successMessage);
    },
    [apiKeyItems, persistItems]
  );

  const handleToggleDisabled = useCallback(
    async (row: ApiKeyRow) => {
      const nextDisabled = !['disabled'].includes(row.status);
      await persistRowMetadata(
        row.index,
        (metadata) => ({
          ...metadata,
          disabled: nextDisabled,
          disabledAt: nextDisabled ? new Date().toISOString() : undefined,
        }),
        nextDisabled ? 'API key disabled' : 'API key enabled'
      );
    },
    [persistRowMetadata]
  );

  const handleRevoke = useCallback(
    (row: ApiKeyRow) => {
      showConfirmation({
        title: 'Revoke API key',
        message: (
          <div className={styles.confirmBody}>
            <div>
              Revoking keeps this key in the config for audit visibility but blocks it from
              authenticating immediately.
            </div>
            <code>{row.fingerprint}</code>
          </div>
        ),
        confirmText: 'Revoke key',
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: async () => {
          await persistRowMetadata(
            row.index,
            (metadata) => ({
              ...metadata,
              revoked: true,
              revokedAt: new Date().toISOString(),
              disabled: true,
              disabledAt: metadata.disabledAt || new Date().toISOString(),
            }),
            'API key revoked'
          );
        },
      });
    },
    [persistRowMetadata, showConfirmation, t]
  );

  const handleCopyUsageLink = useCallback(
    async (apiKey: string) => {
      const copied = await copyToClipboard(buildUsageLink(apiKey));
      showNotification(
        t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const handleCopySelectedUsageLinks = useCallback(async () => {
    const text = selectedRowsList.map((row) => buildUsageLink(row.key)).join('\n');
    const copied = await copyToClipboard(text);
    showNotification(
      copied ? 'Usage links copied' : t('notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  }, [selectedRowsList, showNotification, t]);

  const handleGenerate = useCallback(() => {
    setFormState((current) => ({ ...current, key: generateSecureApiKey() }));
    setFormError('');
  }, []);

  const handleExportCsv = useCallback(() => {
    const header = [
      'name',
      'fingerprint',
      'status',
      'owner',
      'environment',
      'scope',
      'allowed_providers',
      'allowed_models',
      'ip_allowlist',
      'quota',
      'budget',
      'quota_period',
      'token_quota_limit',
      'token_quota_used',
      'usd_quota_limit',
      'usd_quota_used',
      'requests_today',
      'success_today',
      'failed_today',
      'error_rate',
      'input_tokens',
      'cached_tokens',
      'output_tokens',
      'total_tokens',
      'estimated_cost_usd',
      'last_used',
      'provider',
      'model',
      'endpoint',
      'created_at',
      'expires_at',
      'updated_at',
      'last_rotated_at',
    ];
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const body = visibleRows.map((row) =>
      [
        row.name,
        row.fingerprint,
        row.statusLabel,
        row.owner,
        row.environment,
        row.scope,
        row.allowedProviders,
        row.allowedModels,
        row.ipAllowlist,
        row.quota,
        row.budget,
        row.quotaPeriod,
        row.tokenQuotaLimit,
        row.tokenQuotaUsed,
        row.usdQuotaLimit,
        row.usdQuotaUsed.toFixed(6),
        row.requests,
        row.success,
        row.failed,
        row.errorRate.toFixed(2),
        row.inputTokens,
        row.cachedTokens,
        row.outputTokens,
        row.totalTokens,
        row.costUsd.toFixed(6),
        row.lastUsed || '',
        row.topProvider,
        row.topModel,
        row.endpoint,
        row.createdAt || '',
        row.expiresAt || '',
        row.updatedAt || '',
        row.lastRotatedAt || '',
      ]
        .map(escapeCsv)
        .join(',')
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `api-keys-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [visibleRows]);

  const allFilteredSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selectedRows.has(row.index));

  const toggleSelectedRow = useCallback((index: number) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAllFiltered = useCallback(() => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (visibleRows.every((row) => next.has(row.index))) {
        visibleRows.forEach((row) => next.delete(row.index));
      } else {
        visibleRows.forEach((row) => next.add(row.index));
      }
      return next;
    });
  }, [visibleRows]);

  const modalTitle = useMemo(() => {
    if (modalMode?.type === 'rotate') return 'Rotate API key';
    return modalMode?.type === 'edit'
      ? t('api_keys.edit_modal_title')
      : t('api_keys.add_modal_title');
  }, [modalMode?.type, t]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{t('api_keys.title')}</h1>
          <p className={styles.description}>
            Client credentials, usage risk, rotation, and operational ownership for the proxy
            service.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadKeys({ notifySuccess: true })}
            loading={loading}
            disabled={disabled}
          >
            <IconRefreshCw size={16} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={openAddModal} disabled={disabled || loading}>
            <IconPlus size={16} />
            {t('api_keys.add_button')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}
      {usageError && (
        <div className={styles.warningBox}>Usage analytics partially unavailable: {usageError}</div>
      )}
      {!usageStatisticsEnabled && (
        <div className={styles.warningBox}>
          Usage statistics are disabled. Enable usage-statistics-enabled to populate request, token,
          cost, and last-used fields.
        </div>
      )}

      <div className={styles.metricsGrid}>
        <MetricCard
          label="Total keys"
          value={formatNumber(apiKeys.length)}
          hint={`${formatNumber(rows.length)} configured credentials`}
          icon={<IconKey size={17} />}
        />
        <MetricCard
          label="Used today"
          value={formatNumber(totals.usedKeys)}
          hint={`${formatNumber(totals.requests)} requests`}
          tone="good"
          icon={<IconTrendingUp size={17} />}
        />
        <MetricCard
          label="Needs attention"
          value={formatNumber(totals.attentionKeys)}
          hint={`${formatNumber(totals.failed)} failed requests`}
          tone={totals.attentionKeys > 0 ? 'warning' : 'neutral'}
          icon={<IconShield size={17} />}
        />
        <MetricCard
          label="Tokens today"
          value={formatCompactNumber(totals.totalTokens)}
          hint="input, cache, output, reasoning"
          icon={<IconChartLine size={17} />}
        />
        <MetricCard
          label="Estimated cost"
          value={formatMoney(totals.costUsd)}
          hint="model pricing estimate"
          icon={<IconTimer size={17} />}
        />
      </div>

      <div className={styles.toolbar}>
        <label className={styles.searchBox}>
          <IconSearch size={16} aria-hidden="true" />
          <span className={styles.visuallyHidden}>Search API keys</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, fingerprint, provider, model"
          />
        </label>
        <div className={styles.segmentGroup} role="tablist" aria-label="API key status filter">
          {[
            ['all', 'All'],
            ['active', 'Active'],
            ['used', 'Used'],
            ['idle', 'No usage'],
            ['risk', 'Risk'],
            ['errors', 'Errors'],
            ['blocked', 'Blocked'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? styles.active : ''}
              onClick={() => setStatusFilter(value as StatusFilter)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={styles.sortBox}>
          <span>Sort</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}>
            <option value="risk">Risk first</option>
            <option value="last-used">Last used</option>
            <option value="cost">Cost</option>
            <option value="requests">Requests</option>
            <option value="tokens">Tokens</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
          </select>
        </label>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExportCsv}
          disabled={filteredRows.length === 0}
        >
          <IconDownload size={15} />
          Export CSV
        </Button>
      </div>

      {selectedCount > 0 && (
        <div className={styles.bulkBar}>
          <strong>{selectedCount} selected</strong>
          <span>Bulk actions keep secret values masked in exported data.</span>
          <Button variant="secondary" size="sm" onClick={handleCopySelectedUsageLinks}>
            <IconExternalLink size={15} />
            Copy usage links
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleDeleteIndexes(Array.from(selectedRows))}
            disabled={saving}
          >
            <IconTrash2 size={15} />
            Remove selected
          </Button>
        </div>
      )}

      <div className={styles.contentGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>
              <span className={styles.panelIcon} aria-hidden="true">
                <IconKey size={18} />
              </span>
              <div>
                <h2>Proxy service client keys</h2>
                <p>{formatNumber(visibleRows.length)} visible keys</p>
              </div>
            </div>
            <div className={styles.panelHint}>
              <IconSlidersHorizontal size={15} />
              Owner, environment, lifecycle status, expiry, policy notes, and audit metadata are
              stored per key.
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingState}>{t('common.loading')}</div>
          ) : apiKeys.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>{t('api_keys.empty_title')}</div>
              <div className={styles.emptyDesc}>{t('api_keys.empty_desc')}</div>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>No matching keys</div>
              <div className={styles.emptyDesc}>
                Adjust search or filters to reveal configured keys.
              </div>
            </div>
          ) : (
            <div className={styles.tableScroller}>
              <table className={styles.keyTable}>
                <thead>
                  <tr>
                    <th className={styles.selectCell}>
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAllFiltered}
                        aria-label="Select all visible API keys"
                      />
                    </th>
                    <th>Key</th>
                    <th>Status</th>
                    <th>Usage today</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Last used</th>
                    <th>Provider / model</th>
                    <th className={styles.actionsCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={`${row.key}-${row.index}`}
                      className={selectedIndex === row.index ? styles.selectedRow : ''}
                    >
                      <td className={styles.selectCell} data-label="">
                        <input
                          type="checkbox"
                          checked={selectedRows.has(row.index)}
                          onChange={() => toggleSelectedRow(row.index)}
                          aria-label={`Select ${row.name}`}
                        />
                      </td>
                      <td data-label="Key">
                        <button
                          type="button"
                          className={styles.keyIdentity}
                          onClick={() => setSelectedIndex(row.index)}
                        >
                          <span>{row.name}</span>
                          <code>{row.fingerprint}</code>
                          <small>
                            {row.owner} · {row.environment}
                          </small>
                        </button>
                      </td>
                      <td data-label="Status">
                        <div className={styles.statusStack}>
                          <span className={`${styles.statusPill} ${styles[row.status]}`}>
                            {row.statusLabel}
                          </span>
                          {row.riskBadges.length > 0 && (
                            <div className={styles.riskBadges} aria-label="Risk flags">
                              {row.riskBadges.map((badge) => (
                                <span
                                  key={badge.label}
                                  className={`${styles.riskBadge} ${styles[badge.tone]}`}
                                  title={badge.title}
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="Usage today">
                        <div className={styles.usageCell}>
                          <strong>{formatNumber(row.requests)}</strong>
                          <span>
                            {formatNumber(row.success)} ok / {formatNumber(row.failed)} failed
                          </span>
                        </div>
                      </td>
                      <td data-label="Tokens">
                        <div className={styles.tokenCell}>
                          <strong>{formatCompactNumber(row.totalTokens)}</strong>
                          <TokenSplit row={row} />
                        </div>
                      </td>
                      <td data-label="Cost">{formatMoney(row.costUsd)}</td>
                      <td data-label="Last used">
                        <div className={styles.lastUsedCell}>
                          <strong>{formatRelativeTime(row.lastUsed)}</strong>
                          <span>{formatDateTime(row.lastUsed)}</span>
                        </div>
                      </td>
                      <td data-label="Provider / model">
                        <div className={styles.providerCell}>
                          <span>{row.topProvider}</span>
                          <code>{row.topModel}</code>
                        </div>
                      </td>
                      <td className={styles.actionsCell} data-label="">
                        <div className={styles.rowActions}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedIndex(row.index)}
                          >
                            Details
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCopyUsageLink(row.key)}
                            disabled={disabled || saving}
                          >
                            <IconExternalLink size={15} />
                            Usage
                          </Button>
                          <details className={styles.actionMenu}>
                            <summary aria-label={`More actions for ${row.name}`}>
                              <IconMoreHorizontal size={18} />
                            </summary>
                            <div className={styles.actionMenuPanel} role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => void handleCopy(row.key)}
                                disabled={disabled || saving}
                              >
                                <IconCopy size={15} />
                                Copy secret
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => openEditModal(row.index)}
                                disabled={disabled || saving}
                              >
                                Edit metadata
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => openRotateModal(row.index)}
                                disabled={disabled || saving}
                              >
                                Rotate key
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => void handleToggleDisabled(row)}
                                disabled={disabled || saving || row.status === 'revoked'}
                              >
                                {row.status === 'disabled' ? 'Enable key' : 'Disable key'}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleRevoke(row)}
                                disabled={disabled || saving || row.status === 'revoked'}
                              >
                                Revoke key
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className={styles.dangerMenuItem}
                                onClick={() => handleDeleteIndexes([row.index])}
                                disabled={disabled || saving}
                              >
                                <IconTrash2 size={15} />
                                Remove from config
                              </button>
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedRow && (
          <aside className={styles.detailDrawer} aria-label="API key details">
            <div className={styles.drawerHeader}>
              <div>
                <span className={`${styles.statusPill} ${styles[selectedRow.status]}`}>
                  {selectedRow.statusLabel}
                </span>
                <h2>{selectedRow.name}</h2>
                <code>{selectedRow.fingerprint}</code>
                {selectedRow.riskBadges.length > 0 && (
                  <div className={styles.riskBadges} aria-label="Risk flags">
                    {selectedRow.riskBadges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`${styles.riskBadge} ${styles[badge.tone]}`}
                        title={badge.title}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleCopy(selectedRow.key)}
                disabled={disabled || saving}
              >
                <IconCopy size={15} />
                Copy key
              </Button>
            </div>

            <div className={styles.drawerSection}>
              <h3>Identity</h3>
              <dl className={styles.detailList}>
                <div>
                  <dt>Owner</dt>
                  <dd>{selectedRow.owner}</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{selectedRow.environment}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(selectedRow.createdAt)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>
                    {selectedRow.expiresAt
                      ? formatDateTime(selectedRow.expiresAt)
                      : 'No expiration configured'}
                  </dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDateTime(selectedRow.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Rotated</dt>
                  <dd>{formatDateTime(selectedRow.lastRotatedAt)}</dd>
                </div>
              </dl>
            </div>

            <div className={styles.drawerSection}>
              <h3>Access and limits</h3>
              <dl className={styles.detailList}>
                <div>
                  <dt>Scope</dt>
                  <dd>{selectedRow.scope}</dd>
                </div>
                <div>
                  <dt>Providers</dt>
                  <dd>{selectedRow.allowedProviders}</dd>
                </div>
                <div>
                  <dt>Models</dt>
                  <dd>{selectedRow.allowedModels}</dd>
                </div>
                <div>
                  <dt>IP allowlist</dt>
                  <dd>{selectedRow.ipAllowlist}</dd>
                </div>
	                <div>
	                  <dt>Quota</dt>
	                  <dd>{selectedRow.quota}</dd>
	                </div>
	                <div>
	                  <dt>Budget</dt>
	                  <dd>{selectedRow.budget}</dd>
	                </div>
	                <div>
	                  <dt>Quota period</dt>
	                  <dd>{selectedRow.quotaPeriod}</dd>
	                </div>
	                <div>
	                  <dt>Remaining</dt>
	                  <dd>
	                    {selectedRow.tokenQuotaLimit
	                      ? `${formatCompactNumber(selectedRow.tokenQuotaRemaining)} tokens`
	                      : 'Unlimited tokens'}
	                    {' / '}
	                    {selectedRow.usdQuotaLimit
	                      ? `${formatMoney(selectedRow.usdQuotaRemaining)}`
	                      : 'Unlimited USD'}
	                  </dd>
	                </div>
                <div>
                  <dt>Tags</dt>
                  <dd>{selectedRow.tags.length ? selectedRow.tags.join(', ') : 'No tags'}</dd>
                </div>
              </dl>
              <div className={styles.descriptionBox}>{selectedRow.description}</div>
            </div>

            <div className={styles.drawerSection}>
              <h3>Usage today</h3>
              <div className={styles.drawerStats}>
                <div>
                  <span>Requests</span>
                  <strong>{formatNumber(selectedRow.requests)}</strong>
                </div>
                <div>
                  <span>Error rate</span>
                  <strong>{selectedRow.errorRate.toFixed(1)}%</strong>
                </div>
                <div>
                  <span>Total tokens</span>
                  <strong>{formatCompactNumber(selectedRow.totalTokens)}</strong>
                </div>
                <div>
                  <span>Est. cost</span>
                  <strong>{formatMoney(selectedRow.costUsd)}</strong>
                </div>
              </div>
            </div>

            <div className={styles.drawerSection}>
              <h3>Rotation history</h3>
              <ul className={styles.timelineList}>
                <li>
                  <strong>Current secret</strong>
                  <span>
                    {selectedRow.lastRotatedAt
                      ? `Rotated ${formatRelativeTime(selectedRow.lastRotatedAt)}`
                      : 'No rotation timestamp captured'}
                  </span>
                </li>
                <li>
                  <strong>Created</strong>
                  <span>{formatDateTime(selectedRow.createdAt)}</span>
                </li>
                {selectedRow.audit
                  .filter((event) =>
                    String(event.type || '')
                      .toLowerCase()
                      .includes('rotate')
                  )
                  .slice(-4)
                  .reverse()
                  .map((event, index) => (
                    <li key={`${event.at}-${event.type}-rotation-${index}`}>
                      <strong>{event.type || 'rotation'}</strong>
                      <span>
                        {formatDateTime(event.at)} · {event.message || 'Rotation event'}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            <div className={styles.drawerSection}>
              <h3>Recent requests</h3>
              {selectedRow.recentRequests.length === 0 ? (
                <div className={styles.emptyInline}>
                  No captured requests for this key in the loaded window.
                </div>
              ) : (
                <div className={styles.miniTableScroller}>
                  <table className={styles.miniTable}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Provider</th>
                        <th>Status</th>
                        <th>Tokens</th>
                        <th>Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRow.recentRequests.slice(0, 8).map((request, index) => (
                        <tr key={request.id || `${request.timestamp}-${index}`}>
                          <td>{formatRelativeTime(request.timestamp)}</td>
                          <td>
                            <span>{request.provider || '-'}</span>
                            <code>{request.model || '-'}</code>
                          </td>
                          <td>
                            <span
                              className={`${styles.statusPill} ${request.failed ? styles.attention : styles.used}`}
                            >
                              {request.failed ? request.status || 'failed' : request.status || 'ok'}
                            </span>
                          </td>
                          <td>{formatCompactNumber(request.tokens?.total_tokens)}</td>
                          <td>{formatNumber(request.latency?.total)} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={styles.drawerSection}>
              <h3>Audit and security</h3>
              <dl className={styles.detailList}>
                <div>
                  <dt>Policy status</dt>
                  <dd>{selectedRow.policyStatus || 'active'}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{selectedRow.policyReason || 'Allowed'}</dd>
                </div>
                <div>
                  <dt>Disabled at</dt>
                  <dd>{formatDateTime(selectedRow.disabledAt)}</dd>
                </div>
                <div>
                  <dt>Revoked at</dt>
                  <dd>{formatDateTime(selectedRow.revokedAt)}</dd>
                </div>
              </dl>
              {selectedRow.audit.length === 0 ? (
                <div className={styles.emptyInline}>No lifecycle audit events captured yet.</div>
              ) : (
                <ul className={styles.auditList}>
                  {selectedRow.audit
                    .slice(-6)
                    .reverse()
                    .map((event, index) => (
                      <li key={`${event.at}-${event.type}-${index}`}>
                        <strong>{event.type || 'event'}</strong>
                        <span>
                          {formatDateTime(event.at)} · {event.message || 'No message'}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className={styles.dangerZone}>
              <div>
                <h3>Lifecycle actions</h3>
                <p>
                  Disable or revoke before removing config entries so active clients fail in a
                  controlled way.
                </p>
              </div>
              <div className={styles.dangerActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openEditModal(selectedRow.index)}
                  disabled={disabled || saving}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openRotateModal(selectedRow.index)}
                  disabled={disabled || saving}
                >
                  Rotate
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleToggleDisabled(selectedRow)}
                  disabled={disabled || saving || selectedRow.status === 'revoked'}
                >
                  {selectedRow.status === 'disabled' ? 'Enable' : 'Disable'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRevoke(selectedRow)}
                  disabled={disabled || saving || selectedRow.status === 'revoked'}
                >
                  Revoke
                </Button>
                <details className={styles.actionMenu}>
                  <summary aria-label={`More actions for ${selectedRow.name}`}>
                    <IconMoreHorizontal size={18} />
                  </summary>
                  <div className={styles.actionMenuPanel} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.dangerMenuItem}
                      onClick={() => handleDeleteIndexes([selectedRow.index])}
                      disabled={disabled || saving}
                    >
                      <IconTrash2 size={15} />
                      Remove from config
                    </button>
                  </div>
                </details>
              </div>
            </div>
          </aside>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={modalTitle}
        closeDisabled={saving}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              {t('common.cancel')}
            </Button>
            {modalMode?.type === 'rotate' ? (
              <Button onClick={() => void handleRotate()} loading={saving}>
                Rotate and copy
              </Button>
            ) : (
              <Button onClick={() => void handleSave()} loading={saving}>
                {editingIndex >= 0 ? t('common.update') : t('common.add')}
              </Button>
            )}
          </>
        }
      >
        {modalMode?.type === 'rotate' ? (
          <div className={styles.modalForm}>
            <div className={styles.rotateNotice}>
              <strong>
                {apiKeys[rotateIndex] ? maskApiKey(apiKeys[rotateIndex]) : 'Selected key'}
              </strong>
              <span>
                This creates a new secret, replaces the current config entry, and copies the new
                value after save.
              </span>
            </div>
            <div className={styles.generatedKeyBox}>
              <code>{modalMode.nextKey}</code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setModalMode({
                    type: 'rotate',
                    index: modalMode.index,
                    nextKey: generateSecureApiKey(),
                  })
                }
                disabled={saving}
              >
                Regenerate
              </Button>
            </div>
          </div>
        ) : (
          <form className={styles.modalForm} onSubmit={(event) => void handleSave(event)}>
            <div className="form-group">
              <label htmlFor="api-key-value">
                {editingIndex >= 0
                  ? t('api_keys.edit_modal_key_label')
                  : t('api_keys.add_modal_key_label')}
              </label>
              <div className={styles.inputRow}>
                <input
                  id="api-key-value"
                  className="input"
                  value={formState.key}
                  placeholder={t('api_keys.add_modal_key_placeholder')}
                  onChange={(event) => {
                    setFormState((current) => ({ ...current, key: event.target.value }));
                    setFormError('');
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={saving}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={saving}
                >
                  {t('config_management.visual.api_keys.generate')}
                </Button>
              </div>
              {formError && <div className="error-box">{formError}</div>}
            </div>
            <div className={styles.formGrid}>
              <label>
                <span>Name</span>
                <input
                  className="input"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="CI runner, mobile app, staging service"
                  disabled={saving}
                />
              </label>
              <label>
                <span>Owner</span>
                <input
                  className="input"
                  value={formState.owner}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, owner: event.target.value }))
                  }
                  placeholder="team or person"
                  disabled={saving}
                />
              </label>
              <label>
                <span>Environment</span>
                <input
                  className="input"
                  value={formState.environment}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, environment: event.target.value }))
                  }
                  placeholder="production, staging, local"
                  disabled={saving}
                />
              </label>
              <label>
                <span>Expires at</span>
                <input
                  className="input"
                  value={formState.expiresAt}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, expiresAt: event.target.value }))
                  }
                  placeholder="2026-12-31T23:59:59Z"
                  disabled={saving}
                />
              </label>
              <label>
                <span>Scopes</span>
                <input
                  className="input"
                  value={formState.scopes}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, scopes: event.target.value }))
                  }
                  placeholder="chat, responses, images"
                  disabled={saving}
                />
              </label>
              <label>
                <span>Allowed providers</span>
                <input
                  className="input"
                  value={formState.allowedProviders}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      allowedProviders: event.target.value,
                    }))
                  }
                  placeholder="openai, claude, gemini"
                  disabled={saving}
                />
              </label>
	              <label>
	                <span>Allowed models</span>
	                <input
	                  className="input"
	                  value={formState.allowedModels}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, allowedModels: event.target.value }))
	                  }
	                  placeholder="gpt-5*, claude-sonnet"
	                  disabled={saving}
	                />
	              </label>
              <label>
                <span>IP allowlist</span>
                <input
                  className="input"
                  value={formState.ipAllowlist}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, ipAllowlist: event.target.value }))
                  }
                  placeholder="127.0.0.1, 10.0.0.0/8"
                  disabled={saving}
                />
              </label>
              <label>
                <span>Tags</span>
                <input
                  className="input"
                  value={formState.tags}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, tags: event.target.value }))
                  }
                  placeholder="billing, trusted, migration"
                  disabled={saving}
                />
              </label>
	              <label>
	                <span>Quota period</span>
	                <div className={styles.segmentGroup} role="tablist" aria-label="Quota period">
	                  {[
	                    ['daily', 'Daily reset'],
	                    ['one_time', 'One-time'],
	                  ].map(([value, label]) => (
	                    <button
	                      key={value}
	                      type="button"
	                      className={formState.quotaPeriod === value ? styles.active : ''}
	                      onClick={() =>
	                        setFormState((current) => ({
	                          ...current,
	                          quotaPeriod: value as ApiKeyFormState['quotaPeriod'],
	                        }))
	                      }
	                      disabled={saving}
	                    >
	                      {label}
	                    </button>
	                  ))}
	                </div>
	              </label>
	              <label>
	                <span>Token quota</span>
	                <input
	                  className="input"
	                  type="number"
	                  min="0"
	                  value={formState.tokenQuotaLimit}
	                  onChange={(event) =>
	                    setFormState((current) => ({ ...current, tokenQuotaLimit: event.target.value }))
	                  }
	                  placeholder="0 = unlimited"
	                  disabled={saving}
	                />
	              </label>
	              <label>
	                <span>USD quota</span>
	                <input
	                  className="input"
	                  type="number"
	                  min="0"
	                  step="0.01"
	                  value={formState.usdQuotaLimit}
	                  onChange={(event) =>
	                    setFormState((current) => ({
	                      ...current,
	                      usdQuotaLimit: event.target.value,
	                    }))
	                  }
	                  placeholder="0 = unlimited"
	                  disabled={saving}
	                />
	              </label>
            </div>
            <label className={styles.fullWidthField}>
              <span>Description</span>
              <textarea
                className="input"
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Operational context, client app, rotation notes"
                disabled={saving}
                rows={3}
              />
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={formState.disabled}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, disabled: event.target.checked }))
                }
                disabled={saving}
              />
              <span>Disable this key immediately after save</span>
            </label>
          </form>
        )}
      </Modal>
    </div>
  );
}
