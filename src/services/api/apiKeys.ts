/**
 * API 密钥管理
 */

import { apiClient } from './client';

export interface ApiKeyMetadata {
  name?: string;
  owner?: string;
  environment?: string;
  description?: string;
  tags?: string[];
  scopes?: string[];
  allowedProviders?: string[];
  allowedModels?: string[];
  ipAllowlist?: string[];
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  lastRotatedAt?: string;
  disabled?: boolean;
  disabledAt?: string;
  revoked?: boolean;
  revokedAt?: string;
  quotaPeriod?: 'daily' | 'one_time' | string;
  tokenQuotaLimit?: number;
  usdQuotaLimit?: number;
  dailyTokenLimit?: number;
  monthlyBudgetUsd?: number;
  audit?: ApiKeyAuditEvent[];
}

export interface ApiKeyQuotaMetric {
  used?: number;
  limit?: number;
  remaining?: number;
  exceeded?: boolean;
  unlimited?: boolean;
}

export interface ApiKeyQuotaStatus {
  period?: 'daily' | 'one_time' | string;
  periodKey?: string;
  requests?: number;
  tokenQuota?: ApiKeyQuotaMetric;
  usdQuota?: ApiKeyQuotaMetric;
  exceededMetrics?: string[];
  blocked?: boolean;
  storeAvailable?: boolean;
}

export interface ApiKeyAuditEvent {
  type?: string;
  at?: string;
  message?: string;
}

export interface ApiKeyItem {
  index: number;
  id: string;
  key: string;
  maskedKey: string;
  metadata: ApiKeyMetadata;
  status: 'active' | 'disabled' | 'expired' | 'revoked' | string;
  statusReason?: string;
  quotaStatus?: ApiKeyQuotaStatus;
}

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean) : [];

const readNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readQuotaMetric = (input: unknown): ApiKeyQuotaMetric | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  return {
    used: readNumber(value.used),
    limit: readNumber(value.limit),
    remaining: readNumber(value.remaining),
    exceeded: Boolean(value.exceeded),
    unlimited: Boolean(value.unlimited),
  };
};

const normalizeQuotaStatus = (input: unknown): ApiKeyQuotaStatus | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  return {
    period: String(value.period ?? '').trim() || undefined,
    periodKey: String(value.periodKey ?? value['period_key'] ?? '').trim() || undefined,
    requests: readNumber(value.requests),
    tokenQuota: readQuotaMetric(value.tokenQuota ?? value['token_quota']),
    usdQuota: readQuotaMetric(value.usdQuota ?? value['usd_quota']),
    exceededMetrics: readStringArray(value.exceededMetrics ?? value['exceeded_metrics']),
    blocked: Boolean(value.blocked),
    storeAvailable: value.storeAvailable !== undefined ? Boolean(value.storeAvailable) : Boolean(value['store_available']),
  };
};

export const normalizeApiKeyMetadata = (input: unknown): ApiKeyMetadata => {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const dailyTokenLimit = readNumber(value.dailyTokenLimit ?? value['daily-token-limit']);
  const monthlyBudgetUsd = readNumber(value.monthlyBudgetUsd ?? value['monthly-budget-usd']);
  const tokenQuotaLimit =
    readNumber(value.tokenQuotaLimit ?? value['token-quota-limit']) ?? dailyTokenLimit;
  const usdQuotaLimit =
    readNumber(value.usdQuotaLimit ?? value['usd-quota-limit']) ?? monthlyBudgetUsd;
  const quotaPeriod =
    String(value.quotaPeriod ?? value['quota-period'] ?? '').trim() ||
    (dailyTokenLimit !== undefined ? 'daily' : tokenQuotaLimit || usdQuotaLimit ? 'one_time' : undefined);
  return {
    name: String(value.name ?? '').trim() || undefined,
    owner: String(value.owner ?? '').trim() || undefined,
    environment: String(value.environment ?? '').trim() || undefined,
    description: String(value.description ?? '').trim() || undefined,
    tags: readStringArray(value.tags),
    scopes: readStringArray(value.scopes),
    allowedProviders: readStringArray(value.allowedProviders ?? value['allowed-providers']),
    allowedModels: readStringArray(value.allowedModels ?? value['allowed-models']),
    ipAllowlist: readStringArray(value.ipAllowlist ?? value['ip-allowlist']),
    createdAt: String(value.createdAt ?? value['created-at'] ?? '').trim() || undefined,
    updatedAt: String(value.updatedAt ?? value['updated-at'] ?? '').trim() || undefined,
    expiresAt: String(value.expiresAt ?? value['expires-at'] ?? '').trim() || undefined,
    lastRotatedAt:
      String(value.lastRotatedAt ?? value['last-rotated-at'] ?? '').trim() || undefined,
    disabled: Boolean(value.disabled),
    disabledAt: String(value.disabledAt ?? value['disabled-at'] ?? '').trim() || undefined,
    revoked: Boolean(value.revoked),
    revokedAt: String(value.revokedAt ?? value['revoked-at'] ?? '').trim() || undefined,
    quotaPeriod,
    tokenQuotaLimit,
    usdQuotaLimit,
    dailyTokenLimit,
    monthlyBudgetUsd,
    audit: Array.isArray(value.audit)
      ? value.audit.map((event) => {
          const entry = (event && typeof event === 'object' ? event : {}) as Record<
            string,
            unknown
          >;
          return {
            type: String(entry.type ?? '').trim() || undefined,
            at: String(entry.at ?? '').trim() || undefined,
            message: String(entry.message ?? '').trim() || undefined,
          };
        })
      : [],
  };
};

const normalizeApiKeyItem = (input: unknown, index: number): ApiKeyItem | null => {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const key = String(value.key ?? '').trim();
  if (!key) return null;
  return {
    index: Number.isFinite(Number(value.index)) ? Number(value.index) : index,
    id: String(value.id ?? '').trim(),
    key,
    maskedKey: String(value.maskedKey ?? value['masked-key'] ?? '').trim(),
    metadata: normalizeApiKeyMetadata(value.metadata),
    status: String(value.status ?? 'active'),
    statusReason: String(value.statusReason ?? value['status-reason'] ?? '').trim() || undefined,
    quotaStatus: normalizeQuotaStatus(value.quotaStatus ?? value['quota-status']),
  };
};

export const serializeApiKeyMetadata = (metadata: ApiKeyMetadata): Record<string, unknown> => ({
  name: metadata.name || undefined,
  owner: metadata.owner || undefined,
  environment: metadata.environment || undefined,
  description: metadata.description || undefined,
  tags: metadata.tags?.length ? metadata.tags : undefined,
  scopes: metadata.scopes?.length ? metadata.scopes : undefined,
  'allowed-providers': metadata.allowedProviders?.length ? metadata.allowedProviders : undefined,
  'allowed-models': metadata.allowedModels?.length ? metadata.allowedModels : undefined,
  'ip-allowlist': metadata.ipAllowlist?.length ? metadata.ipAllowlist : undefined,
  'created-at': metadata.createdAt || undefined,
  'updated-at': metadata.updatedAt || undefined,
  'expires-at': metadata.expiresAt || undefined,
  'last-rotated-at': metadata.lastRotatedAt || undefined,
  disabled: metadata.disabled || undefined,
  'disabled-at': metadata.disabledAt || undefined,
  revoked: metadata.revoked || undefined,
  'revoked-at': metadata.revokedAt || undefined,
  'quota-period': metadata.quotaPeriod || undefined,
  'token-quota-limit': metadata.tokenQuotaLimit || undefined,
  'usd-quota-limit': metadata.usdQuotaLimit || undefined,
  audit: metadata.audit?.length ? metadata.audit : undefined,
});

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    return Array.isArray(keys) ? keys.map((key) => String(key)) : [];
  },

  async listDetailed(): Promise<ApiKeyItem[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const items = data.items;
    if (Array.isArray(items)) {
      return items
        .map((item, index) => normalizeApiKeyItem(item, index))
        .filter((item): item is ApiKeyItem => Boolean(item));
    }
    const keys = data['api-keys'] ?? data.apiKeys;
    return Array.isArray(keys)
      ? keys
          .map((key, index) =>
            normalizeApiKeyItem({ key: String(key), index, metadata: {} }, index)
          )
          .filter((item): item is ApiKeyItem => Boolean(item))
      : [];
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  replaceDetailed: (items: Array<{ key: string; metadata: ApiKeyMetadata }>) =>
    apiClient.put('/api-keys', {
      items: items.map((item) => ({
        key: item.key,
        metadata: serializeApiKeyMetadata(item.metadata),
      })),
    }),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
};
