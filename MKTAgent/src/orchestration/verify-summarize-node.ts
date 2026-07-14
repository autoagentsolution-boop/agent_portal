// Verify the summarize + security composition. summarize `requires` security_scan, so the planner always
// runs the Data Guard node FIRST, masks personal/sensitive data (GDPR/PII), and summarize condenses only the
// MASKED copy. Covers: planner composition (security→summarize, security→summarize→email), both runners
// (stubbed LLM incl. masking + fail-closed), the brain seam (propose_task), AND a real executor run
// (plan → run → security_scan + summary artifacts → completed). No LLM spend; one throwaway tenant, cleaned up.
//   npx tsx src/orchestration/verify-summarize-node.ts
import { prisma } from '../db/client.ts';
import { createRun, createNodes, getRunForOwner } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from './executor/workflow-executor.ts';
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { getRunner } from './executor/agent-runners.ts';
import { dispatchTool, type ToolContext } from './atria/atria-tools.ts';

let failed = 0;
const ok = (cond: boolean, label: string): void => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++; };
const chain = (g: GoalSpec): string[] => { const r = planWorkflow(g); return r.ok ? r.plan.nodes.map((n) => n.agentId) : [`ERR:${r.error}`]; };
const task = (targets: string[], slots: Record<string, unknown> = {}): GoalSpec =>
  goalSpec.parse({ taskTargets: targets, outputs: { needsTextPost: false, needsPublishing: false }, slots: { sourceText: 'A long article about tea farming and its economics. Contact Jane Doe at jane@example.com or +1 555 0100.', ...slots }, provider: 'atria-task' });
const baseCtx = (): ToolContext => ({ ownerId: 't', message: 'summarize this', memoryContext: null, instructions: null, sessionId: null, priorGoal: null, existingRunId: null, searched: [], proposal: null, executeRunId: null, scheduleProposal: null, resolvedLead: null });

// Stub LLM: returns a security-scan shape for the Data Guard prompt, a summary shape otherwise — so the
// executor test exercises the REAL two-node masking→summarize flow without any spend.
const stubLlm = async (system: string): Promise<unknown> =>
  /Data Guard/i.test(system)
    ? { hasSensitive: true, findings: [{ category: 'contact', count: 2, example: 'j***@***' }], maskedText: 'A long article about tea farming and its economics. Contact [PERSONAL] at [CONTACT] or [CONTACT].', notice: 'Masked contact details before summarizing.' }
    : { summary: 'Tea margins hinge on yield vs labor cost.', bullets: ['yield drives revenue', 'labor is the top cost'] };

async function main(): Promise<void> {
  console.log('Planner composition (security → summarize by backward-chaining)');
  ok(JSON.stringify(chain(task(['summary']))) === JSON.stringify(['security', 'summarize']), 'summary target → [security, summarize] (Data Guard runs first)');
  const composed = planWorkflow(task(['summary', 'email_result'], { emailTo: 'friend@example.com' }));
  ok(composed.ok, 'security → summarize → email plans ok');
  if (composed.ok) {
    const ids = composed.plan.nodes.map((n) => n.agentId);
    ok(JSON.stringify(ids) === JSON.stringify(['security', 'summarize', 'email_writer', 'email_agent']), 'order security → summarize → email_writer → email_agent');
    const sec = composed.plan.nodes.find((n) => n.agentId === 'security')!;
    const summ = composed.plan.nodes.find((n) => n.agentId === 'summarize')!;
    const writer = composed.plan.nodes.find((n) => n.agentId === 'email_writer')!;
    ok(summ.dependsOn.includes(sec.nodeId), 'summarize depends on security (reads the masked text)');
    ok(writer.dependsOn.includes(summ.nodeId), 'email_writer depends on summarize (grounds on the summary)');
  }
  // Marketing goals must never select summarize/security (taskTargets absent → marketing path).
  const mkt = chain(goalSpec.parse({ outputs: { needsTextPost: true, needsPublishing: true }, slots: { product: 'X' } }));
  ok(!mkt.includes('summarize') && !mkt.includes('security'), 'marketing goal never selects summarize/security');

  console.log('Security runner (stubbed LLM — masks + fails closed)');
  const secOut = await getRunner('security')({ runId: 't', ownerId: 't', goal: task(['summary']), upstream: {}, llmJsonFn: stubLlm as never });
  const secData = secOut.data as { hasSensitive?: boolean; maskedText?: string; findings?: unknown[]; notice?: string };
  ok(secOut.type === 'security_scan', 'security produces a security_scan artifact');
  ok(secData.hasSensitive === true, 'flags sensitive data present');
  ok(!!secData.maskedText && !/jane@example\.com/.test(secData.maskedText), 'maskedText has raw email removed');
  ok(/\[CONTACT\]/.test(secData.maskedText ?? ''), 'sensitive spans replaced with [CATEGORY] tokens');
  // Fail-closed: sensitive detected but no maskedText → must throw, never pass raw source downstream.
  const leakStub = async (s: string): Promise<unknown> => /Data Guard/i.test(s) ? { hasSensitive: true, findings: [{ category: 'contact', count: 1 }], maskedText: '' } : {};
  let leakThrew = false;
  try { await getRunner('security')({ runId: 't', ownerId: 't', goal: task(['summary']), upstream: {}, llmJsonFn: leakStub as never }); } catch { leakThrew = true; }
  ok(leakThrew, 'fails CLOSED when sensitive data found but masking is empty');

  console.log('Summarize runner (reads the masked upstream copy)');
  const out = await getRunner('summarize')({ runId: 't', ownerId: 't', goal: task(['summary']), upstream: { security_scan: secData }, llmJsonFn: stubLlm as never });
  ok(out.type === 'summary', 'runner produces a summary artifact');
  const data = out.data as { summary?: string; bullets?: string[]; fromMaskedSource?: boolean };
  ok(!!data.summary && data.summary.length > 0, 'summary is non-empty');
  ok(data.fromMaskedSource === true, 'summary flags it was built from a masked source');
  ok(Array.isArray(data.bullets) && data.bullets.length === 2, 'bullets captured');
  let threw = false;
  try { await getRunner('summarize')({ runId: 't', ownerId: 't', goal: task(['summary'], { sourceText: '' }), upstream: {}, llmJsonFn: stubLlm as never }); } catch { threw = true; }
  ok(threw, 'summarize fails loud on empty source text with no upstream scan');

  console.log('Brain seam (propose_task — pure planning, no DB)');
  const ctx = baseCtx();
  const res = (await dispatchTool('propose_task', { capability: 'summarize', source_text: 'long text here with jane@example.com' }, ctx)) as { status?: string; agents?: string[] };
  ok(res.status === 'planned', 'propose_task plans a summarize flow');
  ok(JSON.stringify(res.agents) === JSON.stringify(['security', 'summarize']), 'proposed agents = [security, summarize]');
  ok(ctx.proposal !== null && ctx.proposal.outcome.status === 'planned', 'ctx.proposal set to a planned outcome (flow card path)');

  const unsup = baseCtx();
  const ures = (await dispatchTool('propose_task', { capability: 'translate', source_text: 'x' }, unsup)) as { status?: string };
  ok(ures.status === 'unsupported', 'unsupported capability → not planned (brain routed to flag_capability_gap)');
  ok(unsup.proposal === null, 'unsupported capability sets NO proposal');

  console.log('Executor end-to-end (real run, stubbed LLM — plan → run → artifacts → completed)');
  const user = await prisma.user.create({ data: { email: `summarize-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const goal = task(['summary']);
    const planned = planWorkflow(goal);
    if (!planned.ok) { ok(false, 'plan ok for execution'); return; }
    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const opts: ExecuteOptions = { llmJsonFn: stubLlm as never };
    await runWorkflow(run.id, user.id, goal, planned.plan, opts);
    const after = await getRunForOwner(run.id, user.id);
    ok(after?.status === 'completed', 'run completed (no gate, ran straight through)');
    const scan = await prisma.artifact.findFirst({ where: { runId: run.id, type: 'security_scan' } });
    ok(!!scan, 'security_scan artifact stored');
    const sdata = scan?.data as { maskedText?: string } | undefined;
    ok(!!sdata?.maskedText && !/jane@example\.com/.test(sdata.maskedText), 'stored masked text has raw PII removed');
    const artifact = await prisma.artifact.findFirst({ where: { runId: run.id, type: 'summary' } });
    ok(!!artifact, 'summary artifact stored');
    const adata = artifact?.data as { summary?: string; fromMaskedSource?: boolean } | undefined;
    ok(!!adata?.summary, 'stored artifact has the summary text');
    ok(adata?.fromMaskedSource === true, 'summary was built from the masked source');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }

  if (failed) { console.error(`\nFAIL — ${failed} summarize/security check(s) failed.`); process.exit(1); }
  console.log('\nPASS — summarize + security checks green (0 DB persistence beyond throwaway, 0 LLM spend).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
