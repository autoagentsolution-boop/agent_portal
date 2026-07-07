// Unit verification for the Atria approval policy (pure fn — no DB, no network).
// Proves fail-closed behavior: a granted run clears gates only when guardrails hold.
import { atriaApprovalPolicy, guardrailHoldReason, type GuardrailContext, type GateKind } from './approval-policy.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const base: GuardrailContext = {
  connected: true,
  mediaReady: true,
  cleanlyPostable: true,
  estCostUsd: 0.1,
  budgetUsd: 2,
  contentChecksPass: true,
};
const withCtx = (o: Partial<GuardrailContext>): GuardrailContext => ({ ...base, ...o });
const approves = (g: GateKind, o: Partial<GuardrailContext> = {}) => atriaApprovalPolicy(g, withCtx(o)) === 'approve';

// selection: only needs produced content
check('selection approves when content produced', approves('selection'));
check('selection holds when no content', !approves('selection', { contentChecksPass: false }));
check('selection ignores connection/media', approves('selection', { connected: false, mediaReady: false }));

// cost: under-budget approves, over-budget / no-budget holds
check('cost approves under budget', approves('cost', { estCostUsd: 0.5, budgetUsd: 2 }));
check('cost approves at exact budget', approves('cost', { estCostUsd: 2, budgetUsd: 2 }));
check('cost holds over budget', !approves('cost', { estCostUsd: 3, budgetUsd: 2 }));
check('cost holds when no budget configured (fail-closed)', !approves('cost', { budgetUsd: null }));

// publish: ALL guardrails required (fail-closed on any gap)
check('publish approves when all guardrails hold', approves('publish'));
check('publish holds when disconnected', !approves('publish', { connected: false }));
check('publish holds when media missing', !approves('publish', { mediaReady: false }));
check('publish holds when asset unsupported', !approves('publish', { cleanlyPostable: false }));
check('publish holds when content checks fail', !approves('publish', { contentChecksPass: false }));

// hold reasons: null when approved, descriptive when held
check('no reason when publish approves', guardrailHoldReason('publish', withCtx({})) === null);
check('reason names the missing guardrail', /not connected/.test(guardrailHoldReason('publish', withCtx({ connected: false })) ?? ''),
  guardrailHoldReason('publish', withCtx({ connected: false })));
check('cost reason names budget', /budget/.test(guardrailHoldReason('cost', withCtx({ estCostUsd: 9, budgetUsd: 1 })) ?? ''));

console.log(failures === 0 ? '\nPASS — approval-policy fail-closed checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
