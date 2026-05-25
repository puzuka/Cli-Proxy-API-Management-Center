import type { UsageSnapshot, UsageWindow } from '@/types/usagePortal';

const USAGE_REQUEST_TIMEOUT_MS = 15 * 1000;

type UsageErrorPayload = {
  error?: string;
  message?: string;
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

      return (await response.json()) as UsageSnapshot;
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
