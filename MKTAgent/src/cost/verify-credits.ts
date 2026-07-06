// Verify the credit model (Atria Phase 03) — friendly credits from real tokens. Pure, no DB.
import { creditsFromTokens, withCredits, TOKENS_PER_CREDIT } from './credits.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

ck('zero tokens → 0 credits', creditsFromTokens(0) === 0);
ck('negative tokens → 0 credits', creditsFromTokens(-500) === 0);
// Any real spend shows at least 1 credit (never a misleading 0).
ck('tiny spend → at least 1 credit', creditsFromTokens(10) === 1, creditsFromTokens(10));
// 15k tokens ≈ 60 credits at the mockup divisor (250).
ck('15k tokens ≈ 60 credits', creditsFromTokens(15_000) === 60, creditsFromTokens(15_000));
ck('divisor is the display constant', TOKENS_PER_CREDIT === 250);
ck('credits scale linearly', creditsFromTokens(2 * TOKENS_PER_CREDIT) === 2);

// withCredits preserves the raw summary + adds credits.
const summary = { promptTokens: 12_000, outputTokens: 3_000, totalTokens: 15_000, costUsd: 0.012 };
const withC = withCredits(summary);
ck('withCredits keeps raw fields', withC.promptTokens === 12_000 && withC.costUsd === 0.012);
ck('withCredits adds credits', withC.credits === 60, withC.credits);
// Preserves extra fields (e.g. flow rollup `runs`).
const rollup = withCredits({ promptTokens: 0, outputTokens: 0, totalTokens: 500, costUsd: 0, runs: 3 });
ck('withCredits preserves extra fields', rollup.runs === 3 && rollup.credits === 2, rollup);

console.log(failures ? `\nFAIL — ${failures} credit check(s) red` : '\nPASS — credit model green');
process.exit(failures ? 1 : 0);
