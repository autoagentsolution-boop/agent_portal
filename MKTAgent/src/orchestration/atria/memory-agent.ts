// Memory Agent (Atria v2 P2-2a) — "Atria learns your style." Turns the user's hand-edited copy into
// PROPOSED learned instructions (source:'memory'), which — once the user approves — flow into every
// future concept_writer run via resolveInstructions (copygen/service.ts already injects
// agentId:'concept_writer' instructions). Nothing is persisted here: proposeMemories only READS the
// edited copy the user chose to keep (a strong preference signal) and asks the LLM to name the
// consistent style rules; acceptance (→ createInstruction) is a separate, explicit user action.
import { prisma } from '../../db/client.ts';
import { env } from '../../config/env.ts';
import { callGeminiJson, type LlmJsonFn } from '../master/llm-json.ts';
import { recordLlmUsage } from '../../cost/llm-usage.ts';

// Mirror atria-suggestions' R4 threshold so the Memory node and the "remember your style?" nudge
// agree on when there's enough signal. Cap the sample so the prompt stays bounded + cheap.
const MIN_EDITS = 3;
const MAX_SAMPLES = 15;
const MAX_PROPOSALS = 3;

// The copy agent every accepted memory targets — the only DAG node that writes post copy.
export const MEMORY_TARGET_AGENT = 'concept_writer';

export interface MemoryProposal { content: string; rationale: string; agentId: string }
export interface MemoryProposalResult {
  editedCount: number; // total hand-edited posts (the trigger signal)
  sampled: number;     // how many had usable copy bodies we analysed
  proposals: MemoryProposal[];
  model: string | null;
}

interface EditedSample { product: string; body: string }

const gatherEditedCopy = async (ownerId: string): Promise<EditedSample[]> => {
  const posts = await prisma.post.findMany({
    where: { ownerId, copyEdited: true },
    orderBy: { updatedAt: 'desc' },
    take: MAX_SAMPLES,
    select: { copy: true, campaign: { select: { product: true } } },
  });
  return posts
    .map((p) => ({
      product: p.campaign?.product ?? '',
      body: String((p.copy as { body?: unknown } | null)?.body ?? '').trim(),
    }))
    .filter((s) => s.body);
};

const SYSTEM_PROMPT = [
  "You are Atria's Memory Agent. You infer a marketer's personal copywriting STYLE from posts they",
  'hand-edited to their liking (the edited copy reflects what they prefer over the AI default).',
  'Return 1–3 GENERALISABLE style rules the copy shows CONSISTENTLY — tone, length, emoji use,',
  'structure, CTA style, formality, punctuation. Each rule must be an actionable imperative a',
  'copywriter can follow on ANY future post. Do NOT restate product facts, campaigns, or one-off',
  'wording. If the samples show no consistent pattern, return fewer (or zero) rules — never invent one.',
  'Respond ONLY as JSON: {"proposals":[{"content":"<=200 char imperative rule","rationale":"<=160 char why, cite the pattern"}]}.',
].join(' ');

const buildAnalysisInput = (samples: EditedSample[]): string =>
  [
    `Here are ${samples.length} posts this marketer hand-edited. Infer their consistent style rules.`,
    '',
    ...samples.map((s, i) => `--- Post ${i + 1}${s.product ? ` (${s.product})` : ''} ---\n${s.body}`),
  ].join('\n');

const parseProposals = (raw: unknown): MemoryProposal[] => {
  const arr = (raw as { proposals?: unknown })?.proposals;
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: MemoryProposal[] = [];
  for (const p of arr) {
    const content = String((p as { content?: unknown })?.content ?? '').trim().slice(0, 200);
    const rationale = String((p as { rationale?: unknown })?.rationale ?? '').trim().slice(0, 200);
    const key = content.toLowerCase();
    if (!content || seen.has(key)) continue;
    seen.add(key);
    out.push({ content, rationale, agentId: MEMORY_TARGET_AGENT });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
};

// Analyse an owner's edited copy → proposed style rules. LlmJsonFn is injectable so verification can
// run the loop DRY (no real spend). Records REAL token usage to the ledger under surface 'memory'.
export const proposeMemories = async (
  ownerId: string,
  llm: LlmJsonFn = callGeminiJson,
): Promise<MemoryProposalResult> => {
  const editedCount = await prisma.post.count({ where: { ownerId, copyEdited: true } });
  const samples = await gatherEditedCopy(ownerId);
  if (editedCount < MIN_EDITS || samples.length === 0) {
    return { editedCount, sampled: samples.length, proposals: [], model: null };
  }
  let usage;
  const raw = await llm(SYSTEM_PROMPT, buildAnalysisInput(samples), (u) => { usage = u; });
  if (usage) await recordLlmUsage({ ownerId, surface: 'memory', model: env.GEMINI_MODEL, usage });
  return { editedCount, sampled: samples.length, proposals: parseProposals(raw), model: env.GEMINI_MODEL };
};
