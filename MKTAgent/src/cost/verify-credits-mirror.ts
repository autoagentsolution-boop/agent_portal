// Credit-anchor drift guard (unit tier). The "credits" display anchor lives in TWO files with no
// shared module across the API/web split: BE src/cost/credits.ts (source of truth) and FE
// web/src/lib/credits.ts (mirror). Both comments say "keep in lock-step" — but a comment enforces
// nothing, so a divisor change in one place would silently make the Usage/Impact credit numbers on
// the page disagree with what the server charged. This makes that drift a build failure instead of
// a trust-based convention. The two files legitimately differ in SYNTAX (BE uses `if` blocks, FE a
// ternary) so we can't diff source text — instead we import BOTH modules and assert the anchors +
// conversion OUTPUTS agree across a value grid. Pure compute: no network, no DB, no LLM.
import * as be from './credits.ts';
import * as fe from '../../web/src/lib/credits.ts';

const failures: string[] = [];
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures.push(`${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); console.log(`  FAIL ${name}`, extra ?? ''); }
};

// 1) The anchor constants themselves.
check('TOKENS_PER_CREDIT equal', be.TOKENS_PER_CREDIT === fe.TOKENS_PER_CREDIT, { be: be.TOKENS_PER_CREDIT, fe: fe.TOKENS_PER_CREDIT });
check('USD_PER_CREDIT equal', be.USD_PER_CREDIT === fe.USD_PER_CREDIT, { be: be.USD_PER_CREDIT, fe: fe.USD_PER_CREDIT });

// 2) Conversion OUTPUT parity across a grid that exercises the zero clamp, the Math.max(1,…) floor,
//    rounding, and normal ranges. Any divergent rule (basis, rounding, floor) shows up as a mismatch.
const tokenGrid = [0, -5, 1, 124, 125, 250, 15_000, 999_999];
for (const t of tokenGrid) {
  check(`creditsFromTokens(${t})`, be.creditsFromTokens(t) === fe.creditsFromTokens(t), { be: be.creditsFromTokens(t), fe: fe.creditsFromTokens(t) });
}
const usdGrid = [0, -0.01, 0.0000001, 0.000625, 0.04, 2.5, 100];
for (const u of usdGrid) {
  check(`creditsFromUsd(${u})`, be.creditsFromUsd(u) === fe.creditsFromUsd(u), { be: be.creditsFromUsd(u), fe: fe.creditsFromUsd(u) });
}

if (failures.length) {
  console.log(`\nFAIL — credit anchor drift between BE (src/cost/credits.ts) and FE (web/src/lib/credits.ts):`);
  console.log('  Fix: change the anchor/rule in BOTH files (there is no shared module across the split).');
  process.exit(1);
}
console.log('\nPASS — credit anchors + conversions in lock-step across the API/web split');
process.exit(0);

