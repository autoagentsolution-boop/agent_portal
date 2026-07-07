// Copy-gen tick — one pass of the n8n mkt-copy-gen graph in code:
//   advisory lock → pick one brief|rework Post (+campaign) → build Gemini request
//   → call → parse → on success write copy + status=review; on failure leave the
//   row at its original status (brief|rework) to retry next tick.
//
// State-machine note: unlike the scheduler we do NOT claim-to-an-intermediate
// state before the API call. The n8n flow only flips to `review` on success, so a
// Gemini/quota failure must leave the row regenerable. The advisory lock (its own
// key) is what prevents two ticks picking the same row concurrently.
import { acquireAdvisoryLock } from '../scheduler/lock.ts';
import {
  findCopyGenDueWithCampaign,
  getPostForCopyGen,
  updatePost,
  type PostWithCampaignOwner,
} from '../db/repos/post-repo.ts';
import { buildGeminiBody, buildVariantsBody } from './prompt.ts';
import { resolveCopyConfig } from './resolve-config.ts';
import { resolveLinkedKnowledge } from '../db/repos/product-knowledge-repo.ts';
import { resolveInstructions } from '../orchestration/prompts/resolve-instructions.ts';
import { callGemini } from './gemini.ts';
import { parseGeminiResponse, parseVariants, type CopyVariants } from './parse.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { publishPostStatus } from '../events/bus.ts';
import { env } from '../config/env.ts';
import { recordGeminiCall } from '../cost/llm-usage.ts';

const LOCK_KEY = 'mkt-copy-gen';

// The user's layered "Atria Instructions" for the concept_writer (Atria Phase 02). Injected into
// the copy system prompt (buildGeminiBody) so workspace/campaign/post instructions steer copy too —
// hard copy guardrails (hook ≤50, no HTML, length caps) still win. Empty when the tenant has none.
const conceptInstructions = (post: PostWithCampaignOwner): Promise<string[]> =>
  resolveInstructions({ ownerId: post.ownerId, agentId: 'concept_writer', campaignId: post.campaignId, postId: post.id });

export interface CopyGenResult {
  picked: boolean;
  postId?: string;
  status?: 'review' | 'retry';
  reason?: string;
  error?: string;
}

// Injectable Gemini call for tests (verify without spending API tokens).
export type GeminiFn = (body: ReturnType<typeof buildGeminiBody>) => Promise<unknown>;

// Core: generate copy for ONE already-fetched post (with campaign+owner). Shared
// by the cron tick and the manual UI trigger. Caller holds the advisory lock.
async function processCopyGen(
  post: PostWithCampaignOwner,
  callFn: GeminiFn,
): Promise<CopyGenResult> {
  // Ground copy on the SELECTED product (post-level FK wins over the campaign default); null →
  // buildGeminiBody falls back to campaign.brandContext. Brings copy to parity with image/video.
  const knowledge = await resolveLinkedKnowledge(post.ownerId, post.productKnowledgeId, post.campaign.productKnowledgeId);
  const instructions = await conceptInstructions(post);
  let body: ReturnType<typeof buildGeminiBody>;
  try {
    body = buildGeminiBody(post, undefined, knowledge, instructions);
  } catch (e) {
    // Bad brief (e.g. campaign missing product) → terminal error, won't fix on retry.
    const msg = e instanceof Error ? e.message : String(e);
    await updatePost(post.id, { status: 'error', error: msg.slice(0, 500) });
    await logRun('error', 'mkt_copygen', { id: post.id, error: msg }, post.ownerId);
    publishPostStatus(post.ownerId, {
      postId: post.id,
      status: 'error',
      campaignId: post.campaignId,
      error: msg.slice(0, 500),
    });
    return { picked: true, postId: post.id, status: 'retry', error: msg };
  }

  const raw = await callFn(body);
  // Record the REAL provider call HERE, not in gemini.ts (which has no ownerId in scope).
  // processCopyGen is the shared tail for the cron tick AND the manual "Generate" trigger, so
  // one record-site captures both. Gemini bills the call whether or not the JSON parses below,
  // so record before the parse/ok check — best-effort, never throws, never blocks the flow.
  await recordGeminiCall(raw, { ownerId: post.ownerId, surface: 'copygen', model: env.GEMINI_MODEL, refId: post.id });
  const result = parseGeminiResponse(raw);

  if (!result.ok) {
    // Transient (quota/empty) → leave at original status for next tick/retry.
    await logRun('warn', 'mkt_copygen', { id: post.id, retry: post.status, error: result.error }, post.ownerId);
    logger.warn('copygen_failed_retry', { postId: post.id, error: result.error.slice(0, 200) });
    return { picked: true, postId: post.id, status: 'retry', error: result.error };
  }

  // Persist the language-agnostic copy bag + the resolved language it was
  // generated in (so the row records its own language for adapters/UI).
  const cfg = resolveCopyConfig(post);
  await updatePost(post.id, {
    copy: result.copy as unknown as object,
    language: cfg.language,
    status: 'review',
    error: null,
    copyEdited: false, // fresh generation → not a user edit; concept_writer may regenerate freely
  });
  await logRun(
    'info',
    'mkt_copygen',
    {
      id: post.id,
      status: 'review',
      language: cfg.language,
      lens: { body: result.copy.body.length, threads: result.copy.threads.length, x: result.copy.x.length },
    },
    post.ownerId,
  );
  publishPostStatus(post.ownerId, { postId: post.id, status: 'review', campaignId: post.campaignId });
  return { picked: true, postId: post.id, status: 'review' };
}

export async function runCopyGenTick(callFn: GeminiFn = callGemini): Promise<CopyGenResult> {
  const lock = await acquireAdvisoryLock(LOCK_KEY);
  if (!lock.acquired) {
    logger.info('copygen_tick_skipped', { reason: 'lock_held' });
    return { picked: false, reason: 'lock_held' };
  }
  try {
    const post = await findCopyGenDueWithCampaign();
    if (!post) return { picked: false, reason: 'no_due' };
    return await processCopyGen(post, callFn);
  } catch (e) {
    logger.error('copygen_tick_failed', { error: String(e).slice(0, 300) });
    await logRun('error', 'mkt_copygen', { error: String(e).slice(0, 300) }).catch(() => {});
    return { picked: false, reason: 'error' };
  } finally {
    await lock.release();
  }
}

// Manual trigger (T8): generate copy for a specific owner-scoped post on demand
// (UI "Generate" button), instead of waiting for the cron. The route has already
// checked ownership + that status ∈ {brief,rework}. Shares the global copy-gen
// advisory lock so a manual run and the cron never double-generate the same row;
// if the lock is held → 'lock_held' (route maps to 409 busy, UI retries).
// Text-refine (T-refine): apply a targeted edit to a post's EXISTING copy via the LLM
// (keeps the audit trail — no raw hand-edit). Works on review|ready posts; the result
// lands back at `review` so the user re-approves before it publishes. Shares the copy-gen
// advisory lock so a cron tick can't clobber the refine mid-flight.
export async function refineForPost(
  postId: string,
  ownerId: string,
  instruction: string,
  callFn: GeminiFn = callGemini,
): Promise<CopyGenResult> {
  const lock = await acquireAdvisoryLock(LOCK_KEY);
  if (!lock.acquired) return { picked: false, reason: 'lock_held' };
  try {
    const post = await getPostForCopyGen(postId, ownerId);
    if (!post) return { picked: false, reason: 'not_found' };
    if (post.status !== 'review' && post.status !== 'ready') {
      return { picked: false, postId, reason: 'not_refinable' };
    }
    const current = post.copy as { body: string; threads: string; x: string } | null;
    if (!current) return { picked: false, postId, reason: 'no_copy' };

    const knowledge = await resolveLinkedKnowledge(post.ownerId, post.productKnowledgeId, post.campaign.productKnowledgeId);
    const body = buildGeminiBody(post, { instruction, current }, knowledge, await conceptInstructions(post));
    const raw = await callFn(body);
    // Record once per physical refine call (distinct call site from processCopyGen's — a
    // refine is its own Gemini request, not a re-use of the original generation).
    await recordGeminiCall(raw, { ownerId: post.ownerId, surface: 'copygen', model: env.GEMINI_MODEL, refId: post.id });
    const result = parseGeminiResponse(raw);
    if (!result.ok) {
      logger.warn('copygen_refine_failed', { postId, error: result.error.slice(0, 200) });
      return { picked: true, postId, status: 'retry', error: result.error };
    }
    const cfg = resolveCopyConfig(post);
    await updatePost(post.id, { copy: result.copy as unknown as object, language: cfg.language, status: 'review', error: null, copyEdited: true });
    await logRun('info', 'mkt_copygen_refine', { id: post.id, instruction: instruction.slice(0, 120) }, post.ownerId);
    publishPostStatus(post.ownerId, { postId: post.id, status: 'review', campaignId: post.campaignId });
    return { picked: true, postId: post.id, status: 'review' };
  } catch (e) {
    logger.error('copygen_refine_error', { postId, error: String(e).slice(0, 300) });
    return { picked: false, postId, reason: 'error' };
  } finally {
    await lock.release();
  }
}

export interface VariantsGenResult extends CopyGenResult {
  variants?: CopyVariants[];
}

// Generate N distinct copy variants for the concept selection step (item: concept versions).
// Sets post.copy = variants[0] as a working default (status→review) so the post always has
// copy; the user picks another via /select-variant at the concept gate. Returns the full
// variant list for the caller (concept_writer) to stash on its artifact. Shares the copy-gen
// advisory lock; on a model/parse failure leaves the row regenerable (status=retry).
export async function generateVariantsForPost(
  postId: string,
  ownerId: string,
  n = 4,
  callFn: GeminiFn = callGemini,
): Promise<VariantsGenResult> {
  const lock = await acquireAdvisoryLock(LOCK_KEY);
  if (!lock.acquired) return { picked: false, reason: 'lock_held' };
  try {
    const post = await getPostForCopyGen(postId, ownerId);
    if (!post) return { picked: false, reason: 'not_found' };
    if (post.status !== 'brief' && post.status !== 'rework') return { picked: false, postId, reason: 'not_generatable' };
    const knowledge = await resolveLinkedKnowledge(post.ownerId, post.productKnowledgeId, post.campaign.productKnowledgeId);
    const raw = await callFn(buildVariantsBody(post, n, knowledge, await conceptInstructions(post)));
    // Record once per physical variants call — this is the concept_writer DAG node's ONLY
    // Gemini call (N variants generated in one request), so one ledger row per node run.
    await recordGeminiCall(raw, { ownerId: post.ownerId, surface: 'copygen', model: env.GEMINI_MODEL, refId: post.id });
    const result = parseVariants(raw);
    if (!result.ok) {
      logger.warn('copygen_variants_failed', { postId, error: result.error.slice(0, 200) });
      return { picked: true, postId, status: 'retry', error: result.error };
    }
    const cfg = resolveCopyConfig(post);
    await updatePost(post.id, { copy: result.variants[0] as unknown as object, language: cfg.language, status: 'review', error: null, copyEdited: false });
    await logRun('info', 'mkt_copygen', { id: post.id, status: 'review', variants: result.variants.length, language: cfg.language }, post.ownerId);
    publishPostStatus(post.ownerId, { postId: post.id, status: 'review', campaignId: post.campaignId });
    return { picked: true, postId: post.id, status: 'review', variants: result.variants };
  } catch (e) {
    logger.error('copygen_variants_error', { postId, error: String(e).slice(0, 300) });
    return { picked: false, postId, reason: 'error' };
  } finally {
    await lock.release();
  }
}

export async function generateForPost(
  postId: string,
  ownerId: string,
  callFn: GeminiFn = callGemini,
): Promise<CopyGenResult> {
  const lock = await acquireAdvisoryLock(LOCK_KEY);
  if (!lock.acquired) return { picked: false, reason: 'lock_held' };
  try {
    // Re-read under the lock so a cron tick that just processed this row is seen.
    const post = await getPostForCopyGen(postId, ownerId);
    if (!post) return { picked: false, reason: 'not_found' };
    if (post.status !== 'brief' && post.status !== 'rework') {
      return { picked: false, postId, reason: 'not_generatable' };
    }
    return await processCopyGen(post, callFn);
  } catch (e) {
    logger.error('copygen_manual_failed', { postId, error: String(e).slice(0, 300) });
    return { picked: false, postId, reason: 'error' };
  } finally {
    await lock.release();
  }
}
