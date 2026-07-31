// Phase 2 verification — pure, no real Gemini call. Injects a fake GroundedSearchFn
// to assert runResearch's happy path (dedup + shape) and its fallback path (search
// throws → node must not hard-fail). Mirrors verify-planner.ts's check()/exit style.
//
// Phase-0 characterization (P6): the runResearcher RUNNER (not just the runResearch core) applies a
// GROUNDING_SURCHARGE only when a REAL provider call reported usage, and records the ledger row
// exactly once per such call. This section needs a DB (records a mkt_llm_usage row keyed by runId),
// so the file is now db-tier; the pure runResearch sections above still run without touching it.
import { prisma } from '../db/client.ts';
import { runResearch, type ResearchInput } from '../agents/researcher/run-research.ts';
import { researchSummary } from './schemas/artifact-schemas.ts';
import type { GroundedSearchFn, GroundedResult } from '../agents/researcher/grounded-search.ts';
import { getRunner, type RunnerContext } from './executor/agent-runners.ts';
import { goalSpec } from './schemas/goal-spec.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

const baseInput: ResearchInput = {
  product: 'AI automation suite',
  productKnowledge: 'Automates marketing content generation for small businesses.',
  audience: 'small business owners',
  language: 'en',
  angle: 'save time on content creation',
};

// Happy path — grounded search succeeds with duplicate citations.
{
  console.log('Happy path: grounded search succeeds');
  const fakeSearch: GroundedSearchFn = async () => ({
    text: 'Market insight: small businesses spend 5+ hours/week on content, competitors charge $200+/mo.',
    citations: ['https://a.com', 'https://a.com', 'https://b.com'],
  });

  const result = await runResearch(baseInput, fakeSearch);
  const parsed = researchSummary.safeParse(result);
  check('output passes researchSummary schema', parsed.success, result);
  check('summary non-empty', result.summary.length > 0, result.summary);
  check('sourceNotes de-duped to 2', result.sourceNotes.length === 2, result.sourceNotes);
  check('sourceNotes contain both unique URLs', result.sourceNotes.includes('https://a.com') && result.sourceNotes.includes('https://b.com'), result.sourceNotes);
}

// Fallback path — grounded search throws (e.g. tier without google_search tool).
{
  console.log('Fallback path: grounded search throws');
  const throwingSearch: GroundedSearchFn = async () => {
    throw new Error('google_search tool not supported on this tier');
  };

  let thrown = false;
  let result: Awaited<ReturnType<typeof runResearch>> | undefined;
  try {
    result = await runResearch(baseInput, throwingSearch);
  } catch {
    thrown = true;
  }

  check('runResearch does not throw on search failure', !thrown);
  if (result) {
    const parsed = researchSummary.safeParse(result);
    check('fallback output passes researchSummary schema', parsed.success, result);
    check('fallback sourceNotes is empty array', result.sourceNotes.length === 0, result.sourceNotes);
    check(
      'fallback summary references product/knowledge',
      result.summary.includes(baseInput.productKnowledge!) || result.summary.includes(baseInput.product),
      result.summary,
    );
  }
}

// Fallback path with no productKnowledge — must still fall back to product name.
{
  console.log('Fallback path: no productKnowledge provided');
  const throwingSearch: GroundedSearchFn = async () => {
    throw new Error('network error');
  };
  const input: ResearchInput = { product: 'Widget Pro' };
  const result = await runResearch(input, throwingSearch);
  check('fallback summary references bare product name', result.summary.includes('Widget Pro'), result.summary);
  check('fallback sourceNotes empty', result.sourceNotes.length === 0, result.sourceNotes);
}

// ── P6 characterization: runResearcher RUNNER cost + record-once (guards the researcher-family split).
//    The surcharge and the ledger row are BOTH gated on `usage` being non-null — i.e. a real grounded
//    call. A stubbed research that omits `usage` must add NO surcharge and write NO ledger row.
await (async () => {
  const usageStub = (with_usage: boolean): GroundedSearchFn => async (): Promise<GroundedResult> => ({
    text: 'Real grounded market insight.', citations: ['https://a.com', 'https://a.com', 'https://b.com'],
    ...(with_usage ? { usage: { promptTokens: 1000, outputTokens: 500, thoughtTokens: 200, cachedTokens: 0 } } : {}),
  });
  const mkCtx = (ownerId: string, runId: string, search: GroundedSearchFn): RunnerContext => ({
    runId, ownerId,
    goal: goalSpec.parse({ outputs: { needsResearch: true, needsTextPost: false, needsPublishing: false }, slots: { product: 'Widget Pro', angle: 'save time' }, provider: 'test' }),
    upstream: {}, researchFn: search,
  });

  const user = await prisma.user.create({ data: { email: `p6-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    // (1) Real call (usage present) → surcharge added to NodeCost + exactly one ledger row for this run.
    const realRun = crypto.randomUUID();
    const realOut = await getRunner('content_search')(mkCtx(user.id, realRun, usageStub(true)));
    const realCost = (realOut as { cost?: { costUsd?: number } }).cost;
    check('P6: research_summary artifact returned', realOut.type === 'research_summary', realOut.type);
    check('P6: real call → surcharge in cost (costUsd ≥ 0.035)', (realCost?.costUsd ?? 0) >= 0.035, realCost);
    const realRows = await prisma.llmUsage.count({ where: { runId: realRun, surface: 'research' } });
    check('P6: real call records EXACTLY ONE research ledger row', realRows === 1, realRows);

    // (2) Stubbed call with NO usage → no surcharge (bare estimate) + NO ledger row (record-once gate).
    const dryRun = crypto.randomUUID();
    const dryOut = await getRunner('content_search')(mkCtx(user.id, dryRun, usageStub(false)));
    const dryCost = (dryOut as { cost?: { costUsd?: number } }).cost;
    check('P6: no-usage call → NO grounding surcharge (cost < 0.035, pure estimate)', (dryCost?.costUsd ?? 1) < 0.035, dryCost);
    const dryRows = await prisma.llmUsage.count({ where: { runId: dryRun, surface: 'research' } });
    check('P6: no-usage call records ZERO ledger rows', dryRows === 0, dryRows);
  } finally {
    await prisma.llmUsage.deleteMany({ where: { ownerId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
})();

console.log(failures === 0 ? '\nPASS — all researcher checks green (incl. P6 runner cost)' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
