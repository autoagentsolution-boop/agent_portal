// Email-node verification (P4-lite) — pure + DRY: no DB, no LLM, no real email. Asserts (1) the analyzer
// routes an email request to the email_writer→email_agent DAG (no social platforms) while a marketing
// request is unchanged, and (2) the two runners produce a valid draft and "send" it via a stubbed Gmail
// (zero real sends). Exits non-zero on any failure.
import { analyzeDeterministic, emailOutputs } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { evaluateClarification } from './master/clarification-engine.ts';
import { agentIdList } from './schemas/workflow-plan.ts';
import { emailDraft, emailResult } from './schemas/artifact-schemas.ts';
import { getRunner } from './executor/agent-runners.ts';
import type { RunnerContext } from './executor/agent-runners.ts';
import { goalSpec } from './schemas/goal-spec.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

console.log('Email intent → routing');
const emailGoal = analyzeDeterministic('Gửi email chúc mừng sinh nhật cho bạn tôi tên Lam, email lam.nguyen@example.com, vui vẻ thân mật');
check('needsEmail set', emailGoal.outputs.needsEmail);
check('recipient extracted', emailGoal.slots.emailTo === 'lam.nguyen@example.com', emailGoal.slots.emailTo);
check('social flags off', !emailGoal.outputs.needsPublishing && !emailGoal.outputs.needsTextPost && emailGoal.platforms.length === 0);
check('clarify ready (no platform trap)', evaluateClarification(emailGoal).status === 'ready');
const emailPlan = planWorkflow(emailGoal);
check('plans email_writer→email_agent', emailPlan.ok && agentIdList(emailPlan.plan).join('→') === 'email_writer→email_agent', emailPlan.ok ? agentIdList(emailPlan.plan) : emailPlan.error);

console.log('Research → email composition (BUG-7)');
const researchEmail = goalSpec.parse({ outputs: emailOutputs({ needsEmail: true, needsResearch: true } as never), slots: { emailTo: 'nghiep@example.com', angle: 'top 3 competitor findings' }, provider: 'test' });
const rePlan = planWorkflow(researchEmail);
check('research+email plans content_search→email_writer→email_agent', rePlan.ok && agentIdList(rePlan.plan).join('→') === 'content_search→email_writer→email_agent', rePlan.ok ? agentIdList(rePlan.plan) : rePlan.error);
if (rePlan.ok) {
  const w = rePlan.plan.nodes.find((n) => n.agentId === 'email_writer')!;
  const cs = rePlan.plan.nodes.find((n) => n.agentId === 'content_search')!;
  check('email_writer grounds on the research (depends on content_search)', w.dependsOn.includes(cs.nodeId));
}
const plainEmail = goalSpec.parse({ outputs: emailOutputs({ needsEmail: true, needsResearch: false } as never), slots: { emailTo: 'x@example.com' }, provider: 'test' });
const pePlan = planWorkflow(plainEmail);
check('plain email (no research) stays email_writer→email_agent', pePlan.ok && agentIdList(pePlan.plan).join('→') === 'email_writer→email_agent', pePlan.ok ? agentIdList(pePlan.plan) : pePlan.error);

console.log('Regression — marketing request unchanged');
const mkt = analyzeDeterministic('Write a short Facebook post about our new feature');
check('marketing not routed to email', !mkt.outputs.needsEmail);
const mktPlan = planWorkflow(mkt);
check('marketing still plans concept_writer→publisher', mktPlan.ok && agentIdList(mktPlan.plan).includes('publisher'));

console.log('Runners (DRY — stubbed LLM + Gmail, zero real sends)');
const ctx: RunnerContext = {
  runId: 'test-run',
  ownerId: 'test-owner',
  goal: goalSpec.parse({ ...emailGoal }),
  upstream: {},
  // Stub the writer LLM: return a canned draft (no Gemini call / spend).
  llmJsonFn: async () => ({ subject: 'Chúc mừng sinh nhật!', body: 'Chào Lam,\n\nChúc mừng sinh nhật nha!' }),
  // Stub Gmail: pretend-send, return an id (no real email leaves).
  gmailSendFn: async () => ({ id: 'stub-msg-1' }),
};

const writer = await getRunner('email_writer')(ctx);
const draftOk = writer.type === 'email_draft' && emailDraft.safeParse(writer.data).success;
check('email_writer produces a valid email_draft', draftOk, writer.type);
const draft = writer.data as { to: string[]; subject: string; body: string };
check('draft addressed to the recipient', draft.to.includes('lam.nguyen@example.com'), draft.to);

// email_agent reads the draft from upstream (as the executor threads it) and "sends" via the stub.
const sendCtx: RunnerContext = { ...ctx, upstream: { email_draft: draft } };
const sender = await getRunner('email_agent')(sendCtx);
const resParsed = emailResult.safeParse(sender.data);
check('email_agent produces a valid email_result', sender.type === 'email_result' && resParsed.success);
check('status = sent (stub), no real send', resParsed.success && resParsed.data.status === 'sent');

console.log(failures === 0 ? '\nPASS — email-node checks green (0 real emails, 0 LLM spend)' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
