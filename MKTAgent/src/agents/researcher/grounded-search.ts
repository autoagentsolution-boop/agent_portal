// Grounded search — the researcher agent's only data source. Reuses Gemini (same
// key/model as llm-json.ts) but flips on the built-in `google_search` tool instead
// of calling a separate search API/provider (brief: no new external dependency).
// Mirrors llm-json.ts's endpoint/withRetry/timeout style so this stays consistent
// with the rest of the orchestration LLM seams.
import { env } from '../../config/env.ts';
import { withRetry } from '../../lib/retry.ts';
import { extractGeminiUsage } from '../../cost/llm-usage.ts';
import type { GeminiUsage } from '../../orchestration/executor/node-cost.ts';

export interface GroundedResult {
  text: string;
  citations: string[];
  // Real token usage for the ledger (cost-accounting fix). Optional so existing injected
  // GroundedSearchFn stubs (verify scripts, DRY-RUN) that omit it keep compiling unchanged.
  usage?: GeminiUsage;
}

export type GroundedSearchFn = (query: string) => Promise<GroundedResult>;

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

// Gemini's grounding envelope shape (v1beta). Only the fields we read are typed —
// the rest of the response is passed through untouched.
interface GroundingChunk {
  web?: { uri?: string; title?: string };
}
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
  }>;
}

// groundingChunks carry the actual source list (uri + title); groundingSupports
// only cross-references chunks to text spans and adds no new sources, so we don't
// need it for a citation list. Prefer title (more useful to a human reader) and
// fall back to the URI when a source has no title.
const extractCitations = (raw: GenerateContentResponse): string[] => {
  const chunks = raw.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const citations: string[] = [];
  for (const chunk of chunks) {
    const label = chunk.web?.title ?? chunk.web?.uri;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    citations.push(label);
  }
  return citations;
};

const extractText = (raw: GenerateContentResponse): string =>
  raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n').trim() ?? '';

export const groundedSearch: GroundedSearchFn = async (query) => {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const res = await withRetry(
    () =>
      fetch(endpoint(env.GEMINI_MODEL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
          // IMPORTANT: the API rejects responseMimeType: 'application/json' when the
          // google_search tool is attached — grounded answers must be requested as
          // plain text (no generationConfig.responseMimeType here).
          generationConfig: { temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(60_000),
      }),
    { label: 'gemini_grounded_search' },
  );

  if (!res.ok) {
    throw new Error(`grounded_search: gemini http ${res.status}`);
  }

  const raw = (await res.json()) as GenerateContentResponse;
  if (!raw.candidates || raw.candidates.length === 0) {
    throw new Error('grounded_search: no candidates in response');
  }

  const text = extractText(raw);
  if (!text) {
    throw new Error('grounded_search: empty text in response');
  }

  return { text, citations: extractCitations(raw), usage: extractGeminiUsage(raw) };
};
