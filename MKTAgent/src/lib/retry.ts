// Exponential-backoff retry for HTTP/network ops. Ported from
// render-service/src/util/retry.ts — same transient-error taxonomy.
import { logger } from './logger.ts';

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  factor?: number;
  retryOn?: number[];
  label?: string;
}

const DEFAULT_RETRY_STATUS = [429, 500, 502, 503, 504];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const extractStatus = (err: unknown): number | undefined => {
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; response?: { status?: number }; message?: string };
    if (typeof e.status === 'number') return e.status;
    if (typeof e.response?.status === 'number') return e.response.status;
    const match = e.message?.match(/_http_(\d{3})/) ?? e.message?.match(/\b(\d{3})\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
};

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const extractCode = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
};

const isNetworkError = (err: unknown): boolean => {
  const code = extractCode(err);
  return code !== undefined && TRANSIENT_NETWORK_CODES.has(code);
};

export const withRetry = async <T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> => {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  const factor = opts.factor ?? 2;
  const retryOn = opts.retryOn ?? DEFAULT_RETRY_STATUS;
  const label = opts.label ?? 'op';

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = extractStatus(err);
      const network = isNetworkError(err);
      const last = i === attempts - 1;
      const shouldRetry = !last && (network || (status !== undefined && retryOn.includes(status)));
      if (!shouldRetry) throw err;
      const delay = baseMs * Math.pow(factor, i);
      logger.warn('retry_scheduled', { label, attempt: i + 1, delay, status, error: String(err).slice(0, 200) });
      await sleep(delay);
    }
  }
  throw new Error(`withRetry exhausted attempts for ${label}`);
};
