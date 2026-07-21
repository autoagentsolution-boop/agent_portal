// Verify RPD-vs-RPM classification of Gemini RESOURCE_EXHAUSTED payloads, and that the shared
// retry helper stops retrying a daily exhaustion. Pure — no API, no DB.
//
// Bodies below are the real Gemini free-tier 429 shapes (QuotaFailure + RetryInfo details).
import { classifyQuotaBody, quotaErrorFrom, isTerminalQuotaError, QuotaExhaustedError } from './quota-error.ts';
import { withRetry } from './retry.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const body = (quotaId: string, retryDelay?: string): string =>
  JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_requests', quotaId }],
        },
        ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
      ],
    },
  });

// ── classification ────────────────────────────────────────────────────────────────────────────
const day = classifyQuotaBody(body('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
ck('per-day quotaId → daily', day.scope === 'daily', day);

const min = classifyQuotaBody(body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '27s'));
ck('per-minute quotaId → minute', min.scope === 'minute', min);
ck('retryDelay parsed to seconds', min.retryAfterSec === 27, min);

// Both limits reported at once: the day is the binding one.
const both = JSON.stringify({ error: { details: [{ '@type': 'x/google.rpc.QuotaFailure', violations: [
  { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' },
  { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
] }] } });
ck('day + minute together → daily wins', classifyQuotaBody(both).scope === 'daily', classifyQuotaBody(both));

// Unrecognised / non-JSON bodies must degrade to the OLD behaviour (retry), never to a hard stop.
ck('non-JSON body → minute (retryable)', classifyQuotaBody('<html>502 upstream</html>').scope === 'minute');
ck('quota body naming neither limit → minute', classifyQuotaBody(JSON.stringify({ error: { message: 'quota' } })).scope === 'minute');
ck('metric-only per-day naming → daily', classifyQuotaBody(JSON.stringify({ error: { details: [
  { '@type': 'x/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'gl.googleapis.com/requests_per_model_per_day' }] },
] } })).scope === 'daily');

// ── prepaid credit depletion ──────────────────────────────────────────────────────────────────
// THE failure mode this deployment will actually hit (paid prepaid tier). Google ships it with the
// SAME 429/RESOURCE_EXHAUSTED envelope as a rate limit and no quota metadata at all, so without the
// message match it falls through to 'minute', gets retried, and truncates the video again.
// Shape per https://ai.google.dev/gemini-api/docs/billing + the AI Developers forum report.
const depleted = JSON.stringify({
  error: { code: 429, message: 'Your prepayment credits are depleted', status: 'RESOURCE_EXHAUSTED' },
});
ck('prepaid depletion → billing (not minute)', classifyQuotaBody(depleted).scope === 'billing', classifyQuotaBody(depleted));

// The ordinary rate-limit copy contains the word "billing" — matching on that would misclassify
// every RPM burst as a dead account. This pins that it does not.
const rpmCopy = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
  message: 'You exceeded your current quota, please check your plan and billing details.',
  details: [{ '@type': 'x/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] } });
ck('"billing details" in rate-limit copy stays minute', classifyQuotaBody(rpmCopy).scope === 'minute', classifyQuotaBody(rpmCopy));
ck('"insufficient funds" wording → billing', classifyQuotaBody('{"error":{"message":"insufficient funds on billing account"}}').scope === 'billing');

// ── error construction ────────────────────────────────────────────────────────────────────────
const dayErr = quotaErrorFrom(body('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), 'veo-3.1-lite');
ck('daily error is a QuotaExhaustedError', dayErr instanceof QuotaExhaustedError);
ck('daily error is terminal', isTerminalQuotaError(dayErr));
ck('daily message names quota + model', /daily quota/.test(dayErr.message) && /veo-3\.1-lite/.test(dayErr.message), dayErr.message);
ck('carries status 429 for the retry taxonomy', dayErr.status === 429);

const billErr = quotaErrorFrom(depleted, 'veo-3.1-lite');
ck('billing error is terminal', isTerminalQuotaError(billErr));
ck('billing message names the remedy (top up)', /top up/i.test(billErr.message), billErr.message);
ck('billing message names the blast radius (every API key)', /every API key/i.test(billErr.message), billErr.message);

const minErr = quotaErrorFrom(body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '27s'), 'gemini-2.5-flash-image');
ck('minute error is NOT terminal', !isTerminalQuotaError(minErr), minErr.scope);
ck('unrelated error is not terminal', !isTerminalQuotaError(new Error('nano_banana_http_500')));

// ── withRetry behaviour: the point of the whole change ────────────────────────────────────────
const countCalls = async (err: unknown): Promise<number> => {
  let calls = 0;
  try {
    await withRetry(async () => { calls++; throw err; }, { attempts: 3, baseMs: 1, label: 'quota-test' });
  } catch { /* expected */ }
  return calls;
};

ck('daily quota → called ONCE, no backoff burnt', (await countCalls(dayErr)) === 1);
ck('depleted credits → called ONCE, no backoff burnt', (await countCalls(billErr)) === 1);
ck('per-minute quota → still retried to exhaustion', (await countCalls(minErr)) === 3);
ck('plain 429 error → still retried', (await countCalls(Object.assign(new Error('boom'), { status: 429 }))) === 3);

console.log(failures ? `\nFAIL — ${failures} quota-classification check(s) red` : '\nPASS — billing/RPD/RPM classification + non-retry of terminal stops green');
process.exit(failures ? 1 : 0);
