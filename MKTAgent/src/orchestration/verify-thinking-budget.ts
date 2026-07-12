// Verify the per-agent-group thinking-budget policy (Phase 06). Three layers, no LLM spend:
//   1. thinkingBudgetFor() — pure policy math (per-tier + dynamic: summarize by length, creative by pref).
//   2. callGeminiJson() — emits generationConfig.thinkingConfig ONLY when a budget is passed (fetch spied).
//   3. Executor binding e2e — a REAL summarize run (fetch spied, no key spend) proves the node's tier budget
//      reaches the wire; and a DRY-RUN stub (llmJsonFn set) is passed through untouched (no fetch at all).
//   npx tsx src/orchestration/verify-thinking-budget.ts
import { prisma } from '../db/client.ts';
import { env } from '../config/env.ts';
import { createRun, createNodes, getRunForOwner } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from './executor/workflow-executor.ts';
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { thinkingBudgetFor, BRAIN_THINKING_BUDGET } from './thinking-budget.ts';
import { callGeminiJson } from './master/llm-json.ts';

let failed = 0;
const ok = (cond: boolean, label: string): void => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++; };
const eq = (a: unknown, b: unknown, label: string): void => ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const goalWith = (over: Partial<GoalSpec>): GoalSpec =>
  goalSpec.parse({ outputs: { needsTextPost: false, needsPublishing: false }, slots: {}, ...over });

// Spy globalThis.fetch: capture the request body, return a valid summarize envelope. Restores on cleanup.
type Captured = { body: any } | null;
const spyFetch = (payload: unknown): { restore: () => void; last: () => Captured } => {
  const orig = globalThis.fetch;
  let captured: Captured = null;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    captured = { body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { restore: () => { globalThis.fetch = orig; }, last: () => captured };
};

async function main(): Promise<void> {
  console.log('1. Policy — thinkingBudgetFor() per tier');
  eq(BRAIN_THINKING_BUDGET, 4096, 'brain constant = 4096');
  for (const a of ['ideation', 'strategy', 'content_search', 'campaign_strategist']) eq(thinkingBudgetFor(a), 4096, `reasoning ${a} = 4096`);
  for (const a of ['publisher', 'email_agent', 'scheduler']) eq(thinkingBudgetFor(a), 0, `action ${a} = 0`);
  eq(thinkingBudgetFor('unknown_future_node'), 4096, 'unlisted agent → reasoning default');

  console.log('   creative tier scales by goal.qualityPref');
  eq(thinkingBudgetFor('email_writer', { goal: goalWith({ qualityPref: 'standard' }) }), 4096, 'creative standard = 4096');
  eq(thinkingBudgetFor('email_writer', { goal: goalWith({ qualityPref: 'high' }) }), 8192, 'creative high = 8192');
  eq(thinkingBudgetFor('email_writer', { goal: goalWith({ qualityPref: 'economy' }) }), 2048, 'creative economy = 2048');
  eq(thinkingBudgetFor('concept_writer', { goal: goalWith({ qualityPref: 'high' }) }), 8192, 'concept_writer follows creative pref');
  eq(thinkingBudgetFor('email_writer'), 4096, 'creative w/o ctx → standard default');

  console.log('   summarize tier scales by source length (clamped 2048..8192)');
  eq(thinkingBudgetFor('summarize', { goal: goalWith({ slots: { sourceText: '' } }) }), 2048, 'empty source = floor 2048');
  eq(thinkingBudgetFor('summarize', { goal: goalWith({ slots: { sourceText: 'x'.repeat(1200) } }) }), 3072, '1200 chars = 2048 + 2*512');
  eq(thinkingBudgetFor('summarize', { goal: goalWith({ slots: { sourceText: 'x'.repeat(20000) } }) }), 8192, 'max-length source (20000) clamps at 8192');
  eq(thinkingBudgetFor('summarize'), 2048, 'summarize w/o source → floor 2048');

  console.log('2. callGeminiJson — thinkingConfig present iff budget passed (fetch spied)');
  const hadKey = env.GEMINI_API_KEY;
  (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = 'test-key'; // exercise the fetch path without a real key
  try {
    let spy = spyFetch({ ok: true });
    await callGeminiJson('sys', 'user', undefined, { thinkingBudget: 1234 });
    eq(spy.last()?.body?.generationConfig?.thinkingConfig?.thinkingBudget, 1234, 'budget passed → thinkingConfig.thinkingBudget');
    spy.restore();

    spy = spyFetch({ ok: true });
    await callGeminiJson('sys', 'user');
    eq(spy.last()?.body?.generationConfig?.thinkingConfig, undefined, 'no budget → no thinkingConfig key (Gemini default)');
    spy.restore();
  } finally {
    (env as { GEMINI_API_KEY: string }).GEMINI_API_KEY = hadKey;
  }

  console.log('3. Executor binding e2e — the tier budget reaches the wire per node');
  const src = 'x'.repeat(1200); // expected summarize budget = 3072
  const goal = goalWith({ taskTargets: ['summary'], slots: { sourceText: src }, provider: 'atria-task' });
  const planned = planWorkflow(goal);
  if (!planned.ok) { ok(false, 'plan ok for execution'); return; }
  const user = await prisma.user.create({ data: { email: `tb-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    // Real path (NO llmJsonFn in opts) → executor binds callGeminiJson with the node budget; fetch is spied.
    const spy = spyFetch({ summary: 'Tea margins hinge on yield vs labor.', bullets: ['yield', 'labor'] });
    try {
      const run = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
      await createNodes(run.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      await runWorkflow(run.id, user.id, goal, planned.plan, {} as ExecuteOptions);
      const after = await getRunForOwner(run.id, user.id);
      ok(after?.status === 'completed', 'summarize run completed via real (bound) seam');
      eq(spy.last()?.body?.generationConfig?.thinkingConfig?.thinkingBudget, 3072, 'summarize node bound its length-scaled budget (3072) onto the wire');
    } finally {
      spy.restore();
    }

    // DRY-RUN path (llmJsonFn set) → executor must NOT override the stub; fetch is never touched.
    const spy2 = spyFetch({ summary: 'should-not-be-used', bullets: [] });
    try {
      const run2 = await createRun({ ownerId: user.id, goal, plan: planned.plan, status: 'planned' });
      await createNodes(run2.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      const opts: ExecuteOptions = { llmJsonFn: (async () => ({ summary: 'stubbed', bullets: [] })) as never };
      await runWorkflow(run2.id, user.id, goal, planned.plan, opts);
      ok(spy2.last() === null, 'DRY-RUN stub passed through untouched (no fetch, no override)');
    } finally {
      spy2.restore();
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }

  if (failed) { console.error(`\nFAIL — ${failed} thinking-budget check(s) failed.`); process.exit(1); }
  console.log('\nPASS — thinking-budget policy green (0 LLM spend).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
