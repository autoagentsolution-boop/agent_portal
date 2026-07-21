// Provider quota classification. A Gemini 429 (RESOURCE_EXHAUSTED) means one of two very different
// things and the old code treated them identically:
//
//   • per-MINUTE burst  — clears on its own in <60s. Backing off is correct.
//   • per-DAY exhaustion — will not clear today. Backing off burns ~3.5 min per call and then fails
//     anyway, and in runVideo the per-shot catch turned that into a silently truncated video.
//
// The payload distinguishes them: a QuotaFailure detail carries a `quotaId` such as
// `GenerateRequestsPerDayPerProjectPerModel-FreeTier` vs `...PerMinutePerProjectPerModel-FreeTier`,
// and a RetryInfo detail may carry `retryDelay: "27s"`. We read those rather than guessing.
//
// Default when the body names neither: 'minute'. That preserves the previous (retrying) behaviour,
// so an unrecognised shape degrades to what we did before rather than to a hard stop.

export type QuotaScope = 'daily' | 'minute';

export interface QuotaClassification {
  scope: QuotaScope;
  quotaId: string | null;
  retryAfterSec: number | null;
}

export class QuotaExhaustedError extends Error {
  readonly scope: QuotaScope;
  readonly model: string;
  readonly quotaId: string | null;
  readonly retryAfterSec: number | null;
  // Lets the shared `withRetry` status taxonomy (and any caller reading `.status`) keep seeing a 429
  // for the per-minute case, so only the daily case changes behaviour.
  readonly status = 429;

  constructor(
    message: string,
    opts: { scope: QuotaScope; model: string; quotaId?: string | null; retryAfterSec?: number | null },
  ) {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.scope = opts.scope;
    this.model = opts.model;
    this.quotaId = opts.quotaId ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }
}

interface QuotaViolation { quotaId?: string; quotaMetric?: string }
interface ErrorDetail { '@type'?: string; violations?: QuotaViolation[]; retryDelay?: string }

const PER_DAY = /per[_-]?day/i;
const PER_MINUTE = /per[_-]?minute/i;

const parseRetryDelay = (raw?: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)s$/.exec((raw ?? '').trim());
  const sec = m ? Number(m[1]) : NaN;
  return Number.isFinite(sec) && sec > 0 ? sec : null;
};

// Reads the structured details when present, falls back to scanning the raw body. Never throws —
// a classifier that blows up on an unexpected shape would replace a quota error with a parse error.
export const classifyQuotaBody = (body: string): QuotaClassification => {
  let quotaId: string | null = null;
  let retryAfterSec: number | null = null;
  let scope: QuotaScope | null = null;

  try {
    const details = (JSON.parse(body) as { error?: { details?: ErrorDetail[] } })?.error?.details ?? [];
    for (const d of details) {
      if (d.retryDelay) retryAfterSec = retryAfterSec ?? parseRetryDelay(d.retryDelay);
      for (const v of d.violations ?? []) {
        const id = v.quotaId ?? v.quotaMetric ?? '';
        if (!id) continue;
        // A daily violation wins over a concurrent per-minute one: it is the binding limit.
        if (PER_DAY.test(id)) { scope = 'daily'; quotaId = id; }
        else if (PER_MINUTE.test(id) && scope !== 'daily') { scope = 'minute'; quotaId = quotaId ?? id; }
        else quotaId = quotaId ?? id;
      }
    }
  } catch {
    // Non-JSON or truncated body — fall through to the text scan below.
  }

  if (!scope) scope = PER_DAY.test(body) && !PER_MINUTE.test(body) ? 'daily' : 'minute';
  return { scope, quotaId, retryAfterSec };
};

export const quotaErrorFrom = (body: string, model: string): QuotaExhaustedError => {
  const c = classifyQuotaBody(body);
  const message =
    c.scope === 'daily'
      ? `provider daily quota exhausted for ${model}${c.quotaId ? ` (${c.quotaId})` : ''} — resets at the provider's next daily reset`
      : `provider per-minute rate limit hit for ${model}${c.retryAfterSec ? ` (retry in ~${c.retryAfterSec}s)` : ''}`;
  return new QuotaExhaustedError(message, { scope: c.scope, model, quotaId: c.quotaId, retryAfterSec: c.retryAfterSec });
};

export const isDailyQuotaError = (err: unknown): err is QuotaExhaustedError =>
  err instanceof QuotaExhaustedError && err.scope === 'daily';
