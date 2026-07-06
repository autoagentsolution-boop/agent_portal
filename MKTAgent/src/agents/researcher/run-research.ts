// Researcher agent — the DAG's content_search node. Runs a grounded Gemini search
// for market/competitor/proof context on the product, then synthesizes a
// research_summary artifact. This is the only net-new agent in this phase; every
// other node either wraps an existing service (copy-gen, publisher) or is a stub.
import { researchSummary } from '../../orchestration/schemas/artifact-schemas.ts';
import { groundedSearch, type GroundedSearchFn } from './grounded-search.ts';
import { logger } from '../../lib/logger.ts';
import type { GeminiUsage } from '../../orchestration/executor/node-cost.ts';

// Optional usage sink (mirrors llm-json.ts's UsageSink): fires ONLY on the real grounded-search
// path with real usageMetadata, never on the knowledge-only fallback (no provider call was made
// there, so nothing to bill/record). Lets the caller (runResearcher) record to the ledger + cost
// the node from real usage without changing runResearch's validated ResearchOutput return shape.
export type ResearchUsageSink = (usage: GeminiUsage) => void;

export interface ResearchInput {
  product: string;
  productKnowledge?: string | null;
  audience?: string | null;
  language?: string | null;
  angle?: string | null;
}

export interface ResearchOutput {
  summary: string;
  sourceNotes: string[];
}

const MAX_SOURCE_NOTES = 8;
const MAX_SUMMARY_CHARS = 4000;

// Builds a focused query: competitor landscape + audience pain points + proof
// points for the specific product/angle, so the grounded search returns market
// context rather than a generic product description.
const buildQuery = (input: ResearchInput): string => {
  const parts = [
    `Research the market for "${input.product}".`,
    'Find competitors, audience pain points, and credible proof points (stats, trends, expert claims) relevant to marketing this product.',
  ];
  if (input.productKnowledge) parts.push(`Product context: ${input.productKnowledge}`);
  if (input.audience) parts.push(`Target audience: ${input.audience}`);
  if (input.angle) parts.push(`Marketing angle to support: ${input.angle}`);
  parts.push('Summarize the most useful findings for a marketing content writer.');
  return parts.join(' ');
};

// Honest fallback when grounding is unavailable (API tier without google_search,
// transient outage, etc). The DAG node must never hard-fail just because live
// search isn't reachable — we still return a usable (if thinner) summary derived
// from what the caller already told us about the product.
const fallbackSummary = (input: ResearchInput): ResearchOutput => {
  const base = input.productKnowledge?.trim() || input.product;
  const summary = `Live market search was unavailable, so this summary is based only on the provided product context: ${base}.`;
  return { summary, sourceNotes: [] };
};

export const runResearch = async (
  input: ResearchInput,
  search: GroundedSearchFn = groundedSearch,
  onUsage?: ResearchUsageSink,
): Promise<ResearchOutput> => {
  let result: ResearchOutput;

  try {
    const grounded = await search(buildQuery(input));
    // Report usage ONLY when the real call returned it (a real grounded call always does;
    // injected test stubs that omit `usage` simply don't trigger a record — no behavior change).
    if (onUsage && grounded.usage) onUsage(grounded.usage);
    result = {
      // Passed through as-is (translating grounding text into input.language is out of
      // scope for MVP), but capped so a verbose grounding response can't bloat the stored
      // artifact — the downstream writer only needs the insight, not a wall of text.
      summary: grounded.text.trim().slice(0, MAX_SUMMARY_CHARS),
      sourceNotes: Array.from(new Set(grounded.citations)).slice(0, MAX_SOURCE_NOTES),
    };
  } catch (err) {
    logger.warn('researcher_grounding_failed', { error: String(err).slice(0, 300), product: input.product });
    result = fallbackSummary(input);
  }

  // Validate before returning so a shape drift (e.g. grounding response change)
  // fails loudly here in dev rather than silently corrupting a stored artifact.
  return researchSummary.parse(result);
};
