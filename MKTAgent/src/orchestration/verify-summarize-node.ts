// Verify the summarize node (P1b Phase 05) — the first NON-marketing capability, proving the registry
// composes any node with ONLY a registry entry + runner (no planner change) and is reachable + runnable
// end-to-end. Covers: planner composition (summarize alone + summarize→email), the runner (stubbed LLM),
// the brain seam (propose_task), AND a real executor run (plan → run → summary artifact → completed).
// No LLM spend (LLM stubbed); one throwaway tenant for the execution proof, cleaned up.
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
  goalSpec.parse({ taskTargets: targets, outputs: { needsTextPost: false, needsPublishing: false }, slots: { sourceText: 'A long article about tea farming and its economics.', ...slots }, provider: 'atria-task' });
const baseCtx = (): ToolContext => ({ ownerId: 't', message: 'summarize this', memoryContext: null, sessionId: null, priorGoal: null, existingRunId: null, searched: [], proposal: null, executeRunId: null, scheduleProposal: null });

async function main(): Promise<void> {
  console.log('Planner composition (backward-chaining from task targets)');
  ok(JSON.stringify(chain(task(['summary']))) === JSON.stringify(['summarize']), 'summarize alone → [summarize]');
  const composed = planWorkflow(task(['summary', 'email_result'], { emailTo: 'friend@example.com' }));
  ok(composed.ok, 'summarize → email plans ok');
  if (composed.ok) {
    const ids = composed.plan.nodes.map((n) => n.agentId);
    ok(JSON.stringify(ids) === JSON.stringify(['summarize', 'email_writer', 'email_agent']), 'compose order summarize → email_writer → email_agent');
    const writer = composed.plan.nodes.find((n) => n.agentId === 'email_writer')!;
    const summ = composed.plan.nodes.find((n) => n.agentId === 'summarize')!;
    ok(writer.dependsOn.includes(summ.nodeId), 'email_writer depends on summarize (grounds on the summary)');
  }
  // Marketing goals must never select summarize (taskTargets absent → marketing path).
  ok(!chain(goalSpec.parse({ outputs: { needsTextPost: true, needsPublishing: true }, slots: { product: 'X' } })).includes('summarize'), 'marketing goal never selects summarize');

  console.log('Runner (stubbed LLM — no DB, no spend)');
  const stub = async (): Promise<unknown> => ({ summary: 'Tea farming margins hinge on yield and labor cost.', bullets: ['yield drives revenue', 'labor is the top cost'] });
  const out = await getRunner('summarize')({ runId: 't', ownerId: 't', goal: task(['summary']), upstream: {}, llmJsonFn: stub as never });
  ok(out.type === 'summary', 'runner produces a summary artifact');
  const data = out.data as { summary?: string; bullets?: string[] };
  ok(!!data.summary && data.summary.length > 0, 'summary is non-empty');
  ok(Array.isArray(data.bullets) && data.bullets.length === 2, 'bullets captured');
  let threw = false;
  try { await getRunner('summarize')({ runId: 't', ownerId: 't', goal: task(['summary'], { sourceText: '' }), upstream: {}, llmJsonFn: stub as never }); } catch { threw = true; }
  ok(threw, 'runner fails loud on empty source text');

  console.log('Brain seam (propose_task — pure planning, no DB)');
  const ctx = baseCtx();
  const res = (await dispatchTool('propose_task', { capability: 'summarize', source_text: 'long text here' }, ctx)) as { status?: string; agents?: string[] };
  ok(res.status === 'planned', 'propose_task plans a summarize flow');
  ok(JSON.stringify(res.agents) === JSON.stringify(['summarize']), 'proposed agents = [summarize]');
  ok(ctx.proposal !== null && ctx.proposal.outcome.status === 'planned', 'ctx.proposal set to a planned outcome (flow card path)');

  const unsup = baseCtx();
  const ures = (await dispatchTool('propose_task', { capability: 'translate', source_text: 'x' }, unsup)) as { status?: string };
  ok(ures.status === 'unsupported', 'unsupported capability → not planned (brain routed to flag_capability_gap)');
  ok(unsup.proposal === null, 'unsupported capability sets NO proposal');

  console.log('Executor end-to-end (real run, stubbed LLM — plan → run → artifact → completed)');
  const user = await prisma.user.create({ data: { email: `summarize-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const goal = task(['summary']);
    const planned = planWorkflow(goal);
    if (!planned.ok) { ok(false, 'plan ok for execution'); return; }
    const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const opts: ExecuteOptions = { llmJsonFn: (async () => ({ summary: 'Tea margins hinge on yield vs labor cost.', bullets: ['yield', 'labor'] })) as never };
    await runWorkflow(run.id, user.id, goal, planned.plan, opts);
    const after = await getRunForOwner(run.id, user.id);
    ok(after?.status === 'completed', 'run completed (no gate, ran straight through)');
    const artifact = await prisma.artifact.findFirst({ where: { runId: run.id, type: 'summary' } });
    ok(!!artifact, 'summary artifact stored');
    const adata = artifact?.data as { summary?: string } | undefined;
    ok(!!adata?.summary, 'stored artifact has the summary text');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }

  if (failed) { console.error(`\nFAIL — ${failed} summarize-node check(s) failed.`); process.exit(1); }
  console.log('\nPASS — summarize-node checks green (0 DB, 0 LLM spend).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
