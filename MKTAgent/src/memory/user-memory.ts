// User-memory service (Core-Intelligence P3) — the recall + capture brain over user-memory-repo.
// RECALL: rank the owner's durable facts (+ their product library + brand defaults) by keyword
// overlap with the current message, and format a compact block the analyzer injects so Atria stops
// re-asking what it already knows. CAPTURE: after a goal is understood, persist the durable slots
// (product, audience, brand voice, platform preference) so the NEXT session remembers them.
// Keyword-first (no embeddings — YAGNI); everything owner-scoped + best-effort (never blocks a turn).
import { getProfile } from './profile-facade.ts';
import { listMemories, markUsed, rememberKeyed, rememberFreeform, type MemoryRow } from '../db/repos/user-memory-repo.ts';
import type { GoalSpec } from '../orchestration/schemas/goal-spec.ts';

export interface RecalledMemory {
  context: string | null; // formatted block for the prompt, or null when nothing is known
  usedIds: string[]; // memory rows surfaced (usage bumped)
}

// Split into lowercased word tokens (unicode-letter aware so Vietnamese words count). Length ≥ 3
// keeps out noise like "a"/"và" while retaining product names.
const tokenize = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));

const overlap = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

interface Candidate { line: string; score: number; id: string | null; priority: number }

// Keep each recalled line short so a long product-library summary can't bloat the prompt.
const cap = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

// Build the recall block: captured facts (UserMemory) + product-library summaries + brand/language
// defaults, ranked by relevance to the message. Always keeps a few high-priority defaults even at
// score 0 so brand voice/language carry across; caps total lines so the prompt stays lean.
export async function recallForMessage(ownerId: string, message: string): Promise<RecalledMemory> {
  const [memories, profile] = await Promise.all([listMemories(ownerId), getProfile(ownerId).catch(() => null)]);
  const q = tokenize(message);
  const cands: Candidate[] = [];

  for (const m of memories) {
    cands.push({ line: cap(`[${m.kind}] ${m.content}`), score: overlap(tokenize(`${m.key ?? ''} ${m.content}`), q), id: m.id, priority: m.kind === 'brand' || m.kind === 'preference' ? 1 : 0 });
  }
  // Product library (uploaded docs) — recall the ones whose name/summary matches the message.
  for (const p of profile?.products ?? []) {
    const desc = [p.summary, p.targetAudience ? `audience: ${p.targetAudience}` : null, p.differentiators ? `edge: ${p.differentiators}` : null].filter(Boolean).join('; ');
    cands.push({ line: cap(`[product] ${p.name}: ${desc || 'in your product library'}`), score: overlap(tokenize(`${p.name} ${desc}`), q), id: null, priority: 0 });
  }
  // Owner brand/language defaults (User row) — low volume, high value, always eligible.
  if (profile?.brandVoice) cands.push({ line: `[brand] preferred voice: ${profile.brandVoice}`, score: 0, id: null, priority: 1 });
  if (profile?.defaultLanguage) cands.push({ line: `[preference] default language: ${profile.defaultLanguage}`, score: 0, id: null, priority: 1 });

  // Rank: relevance first, then priority defaults, then keep it short.
  const ranked = cands
    .filter((c) => c.score > 0 || c.priority > 0)
    .sort((a, b) => b.score - a.score || b.priority - a.priority)
    .slice(0, 8);
  if (!ranked.length) return { context: null, usedIds: [] };

  const usedIds = ranked.map((c) => c.id).filter((id): id is string => Boolean(id));
  void markUsed(ownerId, usedIds).catch(() => {}); // best-effort usage signal
  const context =
    `What you already KNOW about this user (recalled memory — use these to fill fields; do NOT re-ask what is already here):\n` +
    ranked.map((c) => `- ${c.line}`).join('\n');
  return { context, usedIds };
}

const clean = (s?: string | null): string | null => {
  const t = (s ?? '').trim();
  return t.length > 1 ? t : null;
};

// Persist the durable facts from a goal Atria just understood, so the next session recalls them.
// Deterministic (no LLM) + best-effort. Product is the dedup key for product/audience so re-planning
// the same product updates rather than duplicates.
export async function captureFromGoal(ownerId: string, goal: GoalSpec, sourceSessionId?: string | null): Promise<void> {
  const product = clean(goal.slots.product);
  const details = clean(goal.slots.productDetails);
  const audience = clean(goal.slots.targetAudience);
  const voice = clean(goal.slots.brandVoice);
  const platforms = goal.platforms.filter(Boolean);
  const tasks: Array<Promise<void>> = [];

  if (product) {
    tasks.push(rememberKeyed(ownerId, 'product', product.toLowerCase(), `${product}${details ? `: ${details}` : ''}`, sourceSessionId));
    if (audience) tasks.push(rememberKeyed(ownerId, 'audience', product.toLowerCase(), `audience for ${product}: ${audience}`, sourceSessionId));
  } else if (audience) {
    tasks.push(rememberFreeform(ownerId, 'audience', `target audience: ${audience}`, sourceSessionId));
  }
  if (voice) tasks.push(rememberKeyed(ownerId, 'brand', 'voice', voice, sourceSessionId));
  if (platforms.length) tasks.push(rememberKeyed(ownerId, 'preference', 'platforms', `usually targets: ${platforms.join(', ')}`, sourceSessionId));

  await Promise.allSettled(tasks); // never let a memory write break the turn
}
