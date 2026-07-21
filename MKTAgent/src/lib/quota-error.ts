// Provider quota classification. A Gemini `429 RESOURCE_EXHAUSTED` means one of THREE very different
// things and the old code treated them identically:
//
//   • per-MINUTE burst   — clears on its own in <60s. Backing off is correct.
//   • per-DAY exhaustion — will not clear today. Backing off burns ~3.5 min per call and then fails
//     anyway, and in runVideo the per-shot catch turned that into a silently truncated video.
//   • PREPAID CREDITS depleted — never clears without a human topping up the balance. Retrying is
//     pure waste, and per Google's own billing doc every API key on the billing account stops at
//     once, so nothing downstream will succeed either.
//
// The payload distinguishes the first two: a QuotaFailure detail carries a `quotaId` such as
// `GenerateRequestsPerDayPerProjectPerModel-FreeTier` vs `...PerMinutePerProjectPerModel-FreeTier`,
// and a RetryInfo detail may carry `retryDelay: "27s"`. The third is identified by its message —
// `"Your prepayment credits are depleted"` — because it ships with the same 429/RESOURCE_EXHAUSTED
// envelope and no quota metadata at all. That collision is the trap: on a prepaid account (which
// this deployment is on) an unmatched body would otherwise fall through to 'minute' and retry.
// See https://ai.google.dev/gemini-api/docs/billing.
//
// Default when the body names none of them: 'minute'. That preserves the previous (retrying)
// behaviour, so an unrecognised shape degrades to what we did before rather than to a hard stop.

// 'billing' and 'daily' are TERMINAL for this call — retrying cannot help. 'minute' is transient.
export type QuotaScope = 'billing' | 'daily' | 'minute';

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
// Deliberately narrow. The ordinary rate-limit message is "You exceeded your current quota, please
// check your plan and billing details." — it contains the word "billing", so matching on that would
// misclassify every RPM burst as a dead account. "depleted" / "insufficient funds" do not appear in
// the rate-limit copy.
const CREDITS_DEPLETED = /deplet|insufficient\s+(credit|balance|fund)/i;

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

  // Credit depletion outranks any quota metadata: a dead balance is not waited out.
  if (CREDITS_DEPLETED.test(body)) return { scope: 'billing', quotaId, retryAfterSec: null };
  if (!scope) scope = PER_DAY.test(body) && !PER_MINUTE.test(body) ? 'daily' : 'minute';
  return { scope, quotaId, retryAfterSec };
};

const describe = (scope: QuotaScope, model: string, c: QuotaClassification): string => {
  switch (scope) {
    case 'billing':
      // Names the remedy AND the blast radius — Google stops every API key on the billing account,
      // so the operator must know this is not a video-only outage.
      return `provider prepaid credits are depleted (hit while calling ${model}) — top up the balance in AI Studio; every API key on this billing account is stopped until then`;
    case 'daily':
      return `provider daily quota exhausted for ${model}${c.quotaId ? ` (${c.quotaId})` : ''} — resets at the provider's next daily reset`;
    case 'minute':
      return `provider per-minute rate limit hit for ${model}${c.retryAfterSec ? ` (retry in ~${c.retryAfterSec}s)` : ''}`;
  }
};

export const quotaErrorFrom = (body: string, model: string): QuotaExhaustedError => {
  const c = classifyQuotaBody(body);
  return new QuotaExhaustedError(describe(c.scope, model, c), { scope: c.scope, model, quotaId: c.quotaId, retryAfterSec: c.retryAfterSec });
};

// TERMINAL = retrying this call cannot help, so callers must fail loud instead of degrading.
// Covers both a spent daily quota and a dead prepaid balance; excludes the transient per-minute burst.
export const isTerminalQuotaError = (err: unknown): err is QuotaExhaustedError =>
  err instanceof QuotaExhaustedError && err.scope !== 'minute';
