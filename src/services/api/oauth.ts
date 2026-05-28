/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'kimi'
  | 'xai'
  | 'kiro';

export type KiroAuthMethod = 'builder-id' | 'idc';

export interface KiroAuthOptions {
  /** "builder-id" (default) for free AWS Builder ID accounts, "idc" for IAM Identity Center / Enterprise SSO. */
  method?: KiroAuthMethod;
  /** Required when method === "idc". e.g. https://my-org.awsapps.com/start */
  startUrl?: string;
  /** Required when method === "idc". e.g. us-east-1 */
  region?: string;
}

export interface OAuthStartOptions {
  /** gemini-cli only — Google Cloud project ID. */
  projectId?: string;
  /** kiro only — flow selection and IDC inputs. */
  kiro?: KiroAuthOptions;
}

export interface OAuthStartResponse {
  url: string;
  state?: string;
  /** kiro only — echoes the resolved auth method back to the UI. */
  method?: KiroAuthMethod;
  /** kiro only — user code embedded in the verification URL (informational). */
  user_code?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

const WEBUI_SUPPORTED: OAuthProvider[] = [
  'codex',
  'anthropic',
  'antigravity',
  'gemini-cli',
  'xai'
];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini'
};

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: OAuthStartOptions) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    if (provider === 'kiro' && options?.kiro) {
      const { method, startUrl, region } = options.kiro;
      if (method) params.method = method;
      if (startUrl) params.start_url = startUrl;
      if (region) params.region = region;
    }
    return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: Object.keys(params).length ? params : undefined
    });
  },

  getAuthStatus: (state: string) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state }
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl
    });
  }
};
