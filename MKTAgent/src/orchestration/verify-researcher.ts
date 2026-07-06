// Phase 2 verification — pure, no real Gemini call. Injects a fake GroundedSearchFn
// to assert runResearch's happy path (dedup + shape) and its fallback path (search
// throws → node must not hard-fail). Mirrors verify-planner.ts's check()/exit style.
import { runResearch, type ResearchInput } from '../agents/researcher/run-research.ts';
import { researchSummary } from './schemas/artifact-schemas.ts';
import type { GroundedSearchFn } from '../agents/researcher/grounded-search.ts';

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

console.log(failures === 0 ? '\nPASS — all researcher checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
