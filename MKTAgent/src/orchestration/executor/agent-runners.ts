// AgentRunners — maps a registry agentId to the function that actually produces
// its artifact. This is the ONLY place orchestration touches the existing runtime:
//   concept_writer → materializes a Campaign+Post and calls generateForPost (live)
//   publisher      → calls publishPostNow on that Post (live; gated upstream)
//   others         → schema-valid STUB artifacts so the DAG runs end-to-end now
// No copy-gen/scheduler logic is reimplemented — only their exported cores are used.
import { assetTypeFromOutputs, type GoalSpec } from '../schemas/goal-spec.ts';
import { distinctAssetTypes } from '../../scheduler/resolve-input.ts';
import { resolveLinkedKnowledge, resolveLinkedReferenceImage } from '../../db/repos/product-knowledge-repo.ts';
import { campaignIdeas, strategyBrief, infographicBrief, storyboard, videoScript, videoPrompt, contentCalendar, greetingDraft, greetingResult, type ArtifactType } from '../schemas/artifact-schemas.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, getPostForCopyGen, attachPostMedia, setStatus as setPostStatus } from '../../db/repos/post-repo.ts';
import { resolveCopyConfig, DEFAULT_LANGUAGE } from '../../copygen/resolve-config.ts';
import { getUserById } from '../../db/repos/user-repo.ts';
import { generateVariantsForPost, type GeminiFn } from '../../copygen/service.ts';
import { publishPostNow, type PublishFn } from '../../scheduler/tick.ts';
import { sendGmailAs, type GmailSendFn } from '../../email/gmail-send.ts';
import { runDmWriter, runDmAgent } from '../../messaging/dm-runners.ts';
import type { DmSendFn } from '../../messaging/types.ts';
import { greetTo, type GreetFn } from '../../social/greeting.ts';
import type { MentionInput, ReplyInput } from '../../social/types.ts';
import { isExternalActionsPaused } from '../../system/kill-switch.ts';
import { recordExternalAction } from '../../connectors/audit/external-action-audit-log.ts';
import { findPriorSuccess } from '../../connectors/runtime/idempotency-manager.ts';
import { getLead, markLeadNurtured } from '../../db/repos/lead-repo.ts';
import { getThreadById, isEmailSuppressed } from '../../nurture/nurture-thread-repo.ts';
import { buildUnsubscribeUrl } from '../../nurture/guardrails.ts';
import { callGeminiJson, type LlmJsonFn } from '../master/llm-json.ts';
import { buildAgentPrompt } from '../prompts/build-agent-prompt.ts';
import { resolveInstructions } from '../prompts/resolve-instructions.ts';
import { generate as generateImage, type ImageResult, type ImageRequest } from '../../imagegen/nano-banana.ts';
import { generate as generateVideo, VEO_MODEL_ID, type VideoRequest, type VideoResult } from '../../video/veo.ts';
import { generate as generateTts, type TtsRequest } from '../../video/tts.ts';
import { stitchClips, muxAudio } from '../../video/stitch.ts';
import { access } from 'node:fs/promises';
import { listArtifacts } from './artifact-store.ts';
import { runtimePublishFn } from '../../connectors/runtime/connector-runtime.ts';
import { logger } from '../../lib/logger.ts';
import { isTerminalQuotaError, QuotaExhaustedError } from '../../lib/quota-error.ts';
import { estimateLlmCost, imageCost, videoClipCost, ttsCost, sumCost, costFromUsage, type NodeCost, type GeminiUsage } from './node-cost.ts';
import { runResearch } from '../../agents/researcher/run-research.ts';
import type { GroundedSearchFn } from '../../agents/researcher/grounded-search.ts';
import { suggestPublishTimes, summarizeTiming } from '../../agents/publish-timing/suggest-time.ts';
import { proposeLeadScoringCriteria } from '../../leads/scoring/criteria.ts';
import { env } from '../../config/env.ts';
// Ledger recording (Phase: cost-accounting fix). Best-effort, never throws — recorded ADDITIVELY
// alongside the existing NodeCost (which still drives the wf_node_run display); the ledger is the
// authoritative per-owner total. Record EXACTLY ONCE per physical provider call.
import { recordLlmUsage, recordMediaCost } from '../../cost/llm-usage.ts';
import { platformsOrDefault } from '../../social/default-platforms.ts';

// Google's grounded-search billing is a flat surcharge on top of normal token cost
// (≈$0.035/request after the free tier, 2026-07 public pricing) — see item 4 (researcher).
const GROUNDING_SURCHARGE_USD = 0.035;

// Per-run mutable context threaded through node executions. Artifacts already
// produced upstream are addressable by type (the executor passes them in).
export interface RunnerContext {
  runId: string;
  ownerId: string;
  goal: GoalSpec;
  // Upstream artifact payloads by type (latest wins) — how a node reads its inputs.
  upstream: Partial<Record<ArtifactType, unknown>>;
  // Test seams: stub the LLM / publish so DRY-RUN verification spends nothing and
  // posts nothing (honors the DRY-RUN-only rule for the live publish path).
  geminiFn?: GeminiFn;
  publishFn?: PublishFn;
  // Generic text→JSON LLM seam for ideation/strategy (distinct from geminiFn, which
  // is copy-gen-body shaped). Stubbed in DRY-RUN verification.
  llmJsonFn?: LlmJsonFn;
  // Image generation seam (infographic + storyboard agents). Takes a full ImageRequest so
  // storyboard can reference-condition frames (mode 'edit') for visual consistency. Stubbed
  // in DRY-RUN verification so no real image is generated / no API spend.
  imageFn?: (req: ImageRequest) => Promise<ImageResult>;
  // Video generation seam (video agent — Veo i2v). Stubbed in DRY-RUN verification so
  // no real (slow, paid) video is rendered.
  videoFn?: (req: VideoRequest) => Promise<VideoResult>;
  // Voiceover (TTS) seam (video agent). Stubbed in DRY-RUN verification.
  ttsFn?: (req: TtsRequest) => Promise<{ outputFile: string; cached: boolean }>;
  // ffmpeg stitch/mux seam (video agent). Added 2026-07-21 to close a gap in this pattern: every
  // other media op above was injectable, so a DRY-RUN video run still shelled out to ffmpeg on
  // stub paths and died. Unset → the real stitchClips/muxAudio.
  stitchFn?: (clipPaths: string[]) => Promise<string>;
  muxFn?: (videoPath: string, audioPath: string) => Promise<string>;
  // Web-search seam (researcher agent — Gemini Google-Search grounding). Stubbed in
  // DRY-RUN verification so content_search spends nothing / hits no network. When unset
  // the researcher falls back to its own default grounded call (real API) then to a
  // knowledge-only summary if that call is unavailable.
  researchFn?: GroundedSearchFn;
  // Gmail send seam (email_agent). Stubbed in DRY-RUN verification so no real email is sent;
  // unset → the real owner-Gmail send.
  gmailSendFn?: GmailSendFn;
  // DM send seam (dm_agent, Multi-channel Nurture Nodes Phase 01). Stubbed in DRY-RUN verification so
  // 0 real messages go out; unset → sendDm's real registry dispatch, which is STILL DRY-RUN by
  // default per isLiveDmSend (a live send needs an explicit channel token + ENABLE_LIVE_DM_SEND).
  dmSendFn?: DmSendFn;
  // Greeting send seam (greeting_agent, Multi-channel Nurture Nodes Phase 02). Stubbed in DRY-RUN
  // verification so 0 real posts go out; unset → greetTo's real adapter dispatch, which is STILL
  // DRY-RUN by default per isLiveGreetingSend (a live post needs ENABLE_LIVE_GREETING_SEND too).
  greetFn?: GreetFn;
  // The Post row id materialized by concept_writer, reused by publisher.
  postId?: string;
}

export interface RunnerOutput {
  type: ArtifactType;
  data: unknown;
  // concept_writer sets this so the executor stores it on ctx for publisher.
  postId?: string;
  // Token/cost for this node (Phase 6). Omitted → treated as $0 (stubs, publisher).
  cost?: NodeCost;
}

// BOUNDARY (item 4): concept_writer vs copy-gen are NOT redundant — they are two layers.
//   • concept_writer (this file) = the DAG-NODE SEAM: it materializes OR locates the Post
//     (+ campaign) the run operates on, drives copy-gen once, auto-approves review→ready so
//     the publisher node can claim it, and returns the content_concept artifact. It owns NO
//     copy prompt.
//   • copy-gen's generateForPost (copygen/service.ts) = the REUSABLE COPY ENGINE: the actual
//     LLM copy generation for an existing Post. Also driven standalone by POST
//     /posts/:id/generate and the copygen cron — which is exactly why it must stay separate.
// Merging them would couple the copy engine to the orchestrator and break those other callers.
// The two concept_writer paths below differ ONLY in how they obtain the Post (create-from-goal
// vs locate-attached); their shared tail lives in finalizeConcept().

// Shared tail: run copy-gen on the post to produce 3-5 VARIANTS, stash them on the artifact,
// and default-select variant[0]. Does NOT approve the post — the executor's concept selection
// gate pauses here so the user picks a version (+ optional reference image) before media/publish
// (the review→ready approval happens when the user Continues past the gate). Both concept_writer
// paths funnel through here. copy == variants[chosen] (the active version).
// versionCount = how many copy versions to generate for the user to pick from (per-post, set at
// creation; default 1 — a single version, no picking). Was hardcoded to 4.
const finalizeConcept = async (ctx: RunnerContext, postId: string, versionCount: number): Promise<RunnerOutput> => {
  const { ownerId, goal } = ctx;
  const n = Math.max(1, Math.min(5, versionCount || 1));
  const result = await generateVariantsForPost(postId, ownerId, n, ctx.geminiFn);
  if (result.status !== 'review' || !result.variants?.length) {
    throw new Error(`concept_writer: copy-gen did not reach review (${result.reason ?? result.error ?? result.status})`);
  }
  const variants = result.variants;
  const copy = variants[0]!;

  return {
    type: 'content_concept',
    postId,
    data: {
      mainAngle: goal.slots.angle ?? goal.slots.product ?? 'marketing concept',
      keyMessage: copy.body.slice(0, 200),
      copy,
      variants,
      chosen: 0,
      postId,
    },
    cost: estimateLlmCost(goalContext(ctx), variants.map((v) => `${v.body}\n${v.threads}\n${v.x}`).join('\n')),
  };
};

// concept_writer instance path (LIVE): the Post already exists (created before the run,
// post.runId = this run) and its Campaign already carries the merged strategy. We only
// run copy-gen on it + approve review→ready — we do NOT create a new campaign/post. This
// is the flow-as-template path: one template → many posts, each its own instance run.
// Preserve user-modified copy on a flow re-run (edit-loss fix): emit a content_concept artifact
// built from the CURRENT post.copy — the user's manual edit / version selection / AI refine — WITHOUT
// calling copy-gen. No LLM, no cost. Reuses the prior artifact's variant list when still present so
// the version picker keeps all options; post.copy is the authoritative active copy either way.
const conceptFromExistingCopy = async (ctx: RunnerContext, post: { id: string; copy: unknown }): Promise<RunnerOutput> => {
  const copy = post.copy as { body?: string } | null;
  const existing = (await listArtifacts(ctx.runId)).find((a) => a.type === 'content_concept')?.data as
    | { mainAngle?: string; variants?: unknown[]; chosen?: number }
    | undefined;
  return {
    type: 'content_concept',
    postId: post.id,
    data: {
      mainAngle: existing?.mainAngle ?? ctx.goal.slots.angle ?? ctx.goal.slots.product ?? 'marketing concept',
      keyMessage: (copy?.body ?? '').slice(0, 200),
      copy,
      variants: existing?.variants ?? (copy ? [copy] : []),
      chosen: existing?.chosen ?? 0,
      postId: post.id,
    },
  };
};

const runConceptWriterForExistingPost = async (ctx: RunnerContext, postId: string): Promise<RunnerOutput> => {
  const post = await getPostForOwner(postId, ctx.ownerId);
  if (!post) throw new Error('concept_writer: attached post not found');

  // EDIT-LOSS FIX: if the user has modified the copy (copyEdited — manual edit / version select / AI
  // refine) and this isn't an explicit rework, a flow re-run must PRESERVE that work — emit the
  // existing copy instead of regenerating over it. Only a rework (user asked for new copy) or an
  // unedited post regenerates.
  if (post.copyEdited && post.copy && post.status !== 'rework') {
    return conceptFromExistingCopy(ctx, post);
  }

  // Never silently un-publish (Phase 05 / B-F8): a re-run of concept on an ALREADY-PUBLISHED post
  // used to reset it `posted → brief`, discarding the live-post state and opening a re-publish path
  // (H2). Refuse instead — the /rerun-node API gates this too, so reaching here is a defense-in-depth
  // backstop. Regenerating content for an already-posted post means creating a NEW post, not
  // rewinding the published one.
  if (post.status === 'posted' || post.status === 'partial' || post.status === 'posting') {
    throw new Error(`concept_writer: refusing to re-run on an already-published post (status=${post.status})`);
  }
  // Reset to `brief` so copy-gen runs whether this is the first execution (already brief)
  // or a re-run of a post that reached review/ready (would otherwise be refused as
  // not_generatable). This is the "regenerate this step" semantics for the concept node.
  if (post.status !== 'brief' && post.status !== 'rework') {
    await setPostStatus(post.id, 'brief');
  }
  return finalizeConcept(ctx, post.id, post.versionCount ?? 1);
};

// concept_writer (LIVE): create a real Campaign+Post from the goal, run copy-gen,
// then auto-approve review→ready so the publisher node can claim it. The copy
// review is represented by the Post's status lifecycle, not an executor halt.
// When the run already has an attached post (flow-as-template instance), delegate to
// the existing-post path instead of materializing a new campaign+post.
const runConceptWriter = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  if (ctx.postId) return runConceptWriterForExistingPost(ctx, ctx.postId);
  const { ownerId, goal } = ctx;
  // brandContext = the real product knowledge → copy-gen's resolveCopyConfig reads it
  // ("facts you may use, do not invent beyond these") so copy is grounded, not generic.
  // For a brand/company, ensure SOME brandVoice so copy-gen takes the company-persona
  // path rather than persona-free; a personal account keeps whatever (possibly null)
  // voice the user gave. Use trim()||null not `?? `: the Gemini analyzer can emit an
  // empty string for an unfilled slot, which `??` would NOT replace (only null/undefined).
  const clean = (s?: string | null): string | null => (s && s.trim() ? s.trim() : null);
  const isBrand = goal.slots.accountType === 'business' || goal.slots.accountType === 'company';
  const brandVoice = clean(goal.slots.brandVoice) ?? (isBrand ? 'Professional, trustworthy brand voice' : null);
  const campaign = await createCampaign({
    ownerId,
    flowId: ctx.runId, // link the campaign to the flow that spawned it (sidebar tree)
    product: goal.slots.product ?? 'Untitled product',
    angle: clean(goal.slots.angle),
    brandVoice,
    brandContext: clean(goal.slots.productDetails),
    language: clean(goal.slots.language),
    platforms: platformsOrDefault(goal.platforms),
  });
  const post = await createPost({
    campaignId: campaign.id,
    ownerId,
    runId: ctx.runId, // link the post to the flow that produced it (DAG under post)
    status: 'brief',
    platforms: platformsOrDefault(goal.platforms),
    language: goal.slots.language ?? null,
    lengthSpec: goal.slots.lengthSpec ?? null,
    heroFile: goal.slots.heroFile ?? null,
    // Match the deliverable the plan produces so the executor's media gating runs the right
    // steps (a video flow must NOT default to 'image', which would skip storyboard + video).
    assetType: assetTypeFromOutputs(goal.outputs),
  });

  return finalizeConcept(ctx, post.id, post.versionCount ?? 1);
};

// content_search / researcher (LIVE — Phase 02): market/competitor/pain-point research via
// Gemini Google-Search grounding (no new provider). Grounds later agents (ideation/concept)
// through the research_summary artifact they already consume as an optional input. runResearch
// NEVER throws — a missing search tier degrades to a knowledge-only summary — so this node
// can't hard-fail the DAG on an unavailable grounding tier.
const runResearcher = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const knowledge = await resolveProductKnowledge(ctx);
  const language = await resolveRunLanguage(ctx);
  // onUsage fires ONLY when a real grounded call succeeds (runResearch's fallback path never
  // calls it) — so `usage` doubles as "was a real provider call made" for both costing and
  // the record-once-per-physical-call rule below.
  let usage: GeminiUsage | null = null;
  const data = await runResearch(
    {
      product: ctx.goal.slots.product ?? 'the product',
      productKnowledge: knowledge,
      audience: ctx.goal.slots.targetAudience ?? null,
      language,
      angle: ctx.goal.slots.angle ?? null,
    },
    ctx.researchFn,
    (u) => { usage = u; },
  );
  if (usage) {
    // Grounding is billed as a surcharge on top of normal token cost.
    await recordLlmUsage({
      ownerId: ctx.ownerId,
      surface: 'research',
      model: env.GEMINI_MODEL,
      usage,
      extraCostUsd: GROUNDING_SURCHARGE_USD,
      runId: ctx.runId,
      refId: ctx.postId ?? null,
    });
  }
  let cost: NodeCost;
  if (usage) {
    const tokenCost = costFromUsage(usage, env.GEMINI_MODEL);
    cost = { ...tokenCost, costUsd: tokenCost.costUsd + GROUNDING_SURCHARGE_USD };
  } else {
    cost = estimateLlmCost(`${ctx.goal.slots.product ?? ''}\n${knowledge ?? ''}`, `${data.summary}\n${data.sourceNotes.join('\n')}`);
  }
  return { type: 'research_summary', data, cost };
};

// publisher (LIVE): publish the Post materialized by concept_writer. Gated by the
// executor's approval halt BEFORE this runs; here we just invoke the publish path.
// A stub publishFn (DRY-RUN) returns ok results without hitting any platform.
const runPublisher = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const postId = ctx.postId;
  if (!postId) throw new Error('publisher: no postId from concept_writer');
  // Default the live publish path through the Connector Runtime (§11.7) so external
  // writes travel one validated, auditable chokepoint. A DRY-RUN stub (ctx.publishFn)
  // still overrides it for verification; the runtime falls back to publishTo internally.
  const out = await publishPostNow(postId, ctx.ownerId, ctx.publishFn ?? runtimePublishFn);
  const post = await getPostForOwner(postId, ctx.ownerId);
  // Fail LOUD (Phase 02 / H1): a publish that did not really happen must surface as a FAILED
  // node/run, never a silent `completed`. publishPostNow returns picked=false (claim lost / post
  // not in a publishable state → not_publishable | not_found) or status='error' (every target
  // failed). Either way nothing went out — throw so the executor marks the node failed. `partial`
  // (some targets succeeded, incl. a degraded text-only X fallback) is a real outcome and is kept.
  if (!out.picked || (out.status !== 'posted' && out.status !== 'partial')) {
    const detail = out.reason ?? post?.error ?? out.status ?? 'unknown';
    throw new Error(`publisher: publish did not complete (${detail})`);
  }
  return {
    type: 'publish_result',
    data: {
      postId,
      status: out.status,
      postUrls: (post?.postUrls as Record<string, string> | null) ?? null,
      error: post?.error ?? null,
      // Optimal-time suggestion (Phase 02) persisted on the artifact as a record of what
      // was recommended at the approval gate. The live pre-approval surface is the SSE
      // event emitted at the halt (workflow-executor); this keeps it visible on reload.
      timingSuggestion: summarizeTiming(
        suggestPublishTimes({
          platforms: post?.platforms ?? ctx.goal.platforms,
          audience: ctx.goal.slots.targetAudience ?? null,
          language: await resolveRunLanguage(ctx),
        }),
      ),
    },
  };
};

// Compact, language-agnostic description of the goal for the ideation/strategy LLM
// prompts. Includes upstream artifacts (research, chosen idea) when present.
// Single source of truth for the language a run's CONTENT is generated in. Deliberately
// SEPARATE from the master-agent chat language (which mirrors the user's input): the flow
// follows the user's SETUP — post → campaign → user default — so a user can chat in one
// language and still post in the language they configured. Same chain copy-gen uses, so
// copy / ideation / strategy / infographic / storyboard voiceover all agree. Falls back to
// the goal slot / user default only for legacy runs with no attached post.
const resolveRunLanguage = async (ctx: RunnerContext): Promise<string> => {
  const post = ctx.postId ? await getPostForCopyGen(ctx.postId, ctx.ownerId) : null;
  if (post) return resolveCopyConfig(post).language;
  // No-post (legacy) branch: SAME chain + final default as resolveCopyConfig (M1) so media never
  // diverges from copy — was `|| 'en'` while copy defaulted 'vi'.
  return ctx.goal.slots.language?.trim() || (await getUserById(ctx.ownerId))?.defaultLanguage || DEFAULT_LANGUAGE;
};

// The user's layered "Atria Instructions" for THIS agent + run (Phase 02). Derives the
// campaign from the attached post so campaign/post-scoped instructions resolve; workspace
// instructions always apply. buildAgentPrompt wraps the result in its USER INSTRUCTIONS block
// (hard output contract still wins). Empty for a tenant with no instructions → no prompt change.
const resolveRunInstructions = async (ctx: RunnerContext, agentId: string): Promise<string[]> => {
  const post = ctx.postId ? await getPostForCopyGen(ctx.postId, ctx.ownerId) : null;
  return resolveInstructions({
    ownerId: ctx.ownerId,
    agentId,
    campaignId: post?.campaignId ?? null,
    postId: ctx.postId ?? null,
  });
};

// Product knowledge that grounds the IMAGE/VIDEO prompts: the goal slot first, else the
// campaign's brandContext — where uploaded-document analysis is persisted. Copy-gen already
// reads brandContext (resolveCopyConfig), so this brings the media prompts to parity: a rich
// analyzed profile reaches the image/video subject instead of a bare product name.
const resolveProductKnowledge = async (ctx: RunnerContext): Promise<string | null> => {
  const post = ctx.postId ? await getPostForCopyGen(ctx.postId, ctx.ownerId) : null;
  // Resolution chain (item 6): a linked library entry (post-level, then campaign-level) is the
  // curated source of truth and wins; then the legacy campaign.brandContext; then the goal slot.
  const linked = await resolveLinkedKnowledge(
    ctx.ownerId,
    post?.productKnowledgeId ?? null,
    post?.campaign.productKnowledgeId ?? null,
  );
  if (linked) return linked;
  if (post?.campaign.brandContext?.trim()) return post.campaign.brandContext.trim();
  return ctx.goal.slots.productDetails?.trim() || null;
};

// Visual reference for infographic/storyboard (feedback): the post's own uploaded reference wins
// (concept gate / brief form); else a product image uploaded once at 📚 Product Knowledge, resolved
// via the same post→campaign FK chain. Returns a bare filesystem path (local: stripped) or null.
const resolveReferenceImage = async (ctx: RunnerContext): Promise<string | null> => {
  const post = ctx.postId ? await getPostForCopyGen(ctx.postId, ctx.ownerId) : null;
  if (post?.referenceImage) return localFilePath(post.referenceImage);
  const linked = await resolveLinkedReferenceImage(
    ctx.ownerId,
    post?.productKnowledgeId ?? null,
    post?.campaign.productKnowledgeId ?? null,
  );
  return localFilePath(linked);
};

// `resolvedLang` (the setup language) pins the CONTENT language when provided; without it
// this falls back to the goal slot (cost-estimation callers that don't send an LLM prompt).
// `knowledge` overrides the goal's productDetails when provided (campaign.brandContext fallback).
const goalContext = (ctx: RunnerContext, resolvedLang?: string, knowledge?: string | null): string => {
  const { goal, upstream } = ctx;
  const language = (resolvedLang ?? goal.slots.language ?? '').trim() || null;
  const productKnowledge = (knowledge ?? goal.slots.productDetails ?? '').trim() || null;
  const lines = [
    `Product: ${goal.slots.product ?? 'Unspecified product'}`,
    productKnowledge ? `Product knowledge (use these facts, do not invent beyond them): ${productKnowledge}` : null,
    goal.slots.accountType ? `Marketer type: ${goal.slots.accountType}` : null,
    goal.slots.targetAudience ? `Audience: ${goal.slots.targetAudience}` : null,
    goal.slots.angle ? `Angle: ${goal.slots.angle}` : null,
    goal.slots.brandVoice ? `Brand voice: ${goal.slots.brandVoice}` : null,
    language ? `Language: ${language}` : null,
    goal.platforms.length ? `Platforms: ${goal.platforms.join(', ')}` : null,
  ].filter(Boolean);
  const research = upstream.research_summary as { summary?: string } | undefined;
  if (research?.summary) lines.push(`Research: ${research.summary}`);
  const ideas = upstream.campaign_ideas as { chosen?: string } | undefined;
  if (ideas?.chosen) lines.push(`Chosen idea: ${ideas.chosen}`);
  return lines.join('\n');
};

// ideation (LIVE): brainstorm campaign directions + pick one. Validates the LLM
// output against the artifact schema here so a bad response fails the node loudly.
const runIdeation = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const { system } = buildAgentPrompt('ideation', { language, userInstructions: await resolveRunInstructions(ctx, 'ideation') });
  const prompt = goalContext(ctx, language, await resolveProductKnowledge(ctx));
  // onUsage reports REAL token usage from the live call; injected DRY-RUN stubs ignore the
  // sink, so `usage` stays null there — doubles as "was this a real call" for the ledger guard.
  let usage: GeminiUsage | null = null;
  const raw = await call(system, prompt, (u) => { usage = u; });
  const parsed = campaignIdeas.safeParse(raw);
  if (!parsed.success) throw new Error(`ideation: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'orchestration', model: env.GEMINI_MODEL, usage, runId: ctx.runId, refId: ctx.postId ?? null });
  return {
    type: 'campaign_ideas',
    data: parsed.data,
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(system + prompt, JSON.stringify(parsed.data)),
  };
};

// strategy (LIVE): turn the chosen idea into a positioning/audience/pillars brief.
const runStrategy = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const { system } = buildAgentPrompt('strategy', { language, userInstructions: await resolveRunInstructions(ctx, 'strategy') });
  const prompt = goalContext(ctx, language, await resolveProductKnowledge(ctx));
  let usage: GeminiUsage | null = null;
  const raw = await call(system, prompt, (u) => { usage = u; });
  const parsed = strategyBrief.safeParse(raw);
  if (!parsed.success) throw new Error(`strategy: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'orchestration', model: env.GEMINI_MODEL, usage, runId: ctx.runId, refId: ctx.postId ?? null });
  // Strategist ↔ Lead Collector bridge (Phase 02): propose lead-scoring weights tuned to the
  // brief's funnel stage + audience. Deterministic (no extra LLM cost); rides on the artifact so
  // the user can see/tune it. The rule scorer already accepts a LeadScoringCriteria override.
  const data = { ...parsed.data, leadScoringCriteria: proposeLeadScoringCriteria({ funnelStage: parsed.data.funnelStage, audience: parsed.data.audience }) };
  return {
    type: 'strategy_brief',
    data,
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(system + prompt, JSON.stringify(data)),
  };
};

// campaign_strategist (LIVE — Atria Phase 03): from a campaign intent + the strategy brief,
// author an editable N-slot content calendar (pillars × funnel arc × cadence × platform format).
// Uses the shared expert builder + the user's instructions, grounded in product knowledge. The
// run parks at the strategist's selection gate with the calendar for the user to review/edit
// before Phase 04 materializes it into scheduled posts. N ≈ cadence × duration.
const runCampaignStrategist = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const { system } = buildAgentPrompt('campaign_strategist', {
    language,
    userInstructions: await resolveRunInstructions(ctx, 'campaign_strategist'),
  });
  const weeks = ctx.goal.duration?.weeks ?? 4;
  const perWeek = ctx.goal.cadence?.postsPerWeek ?? 3;
  const slotCount = Math.max(1, Math.min(60, weeks * perWeek));
  const platforms = platformsOrDefault(ctx.goal.platforms);
  const strat = ctx.upstream.strategy_brief as { pillars?: string[]; funnelStage?: string } | undefined;
  const parts = [
    goalContext(ctx, language, await resolveProductKnowledge(ctx)),
    `Campaign scope: ${ctx.goal.campaignScope}. Duration: ${weeks} week(s). Cadence: ${perWeek} post(s)/week.`,
    `Produce EXACTLY ${slotCount} slots, spread across ${weeks * 7} days via dayOffset (honor the cadence).`,
    strat?.pillars?.length ? `Content pillars to rotate: ${strat.pillars.join(', ')}.` : null,
    strat?.funnelStage ? `Primary funnel stage: ${strat.funnelStage}.` : null,
    `Target platforms (assign a non-empty subset per slot): ${platforms.join(', ')}.`,
  ].filter(Boolean);
  const prompt = parts.join('\n');
  let usage: GeminiUsage | null = null;
  const raw = await call(system, prompt, (u) => { usage = u; });
  const parsed = contentCalendar.safeParse(raw);
  if (!parsed.success) throw new Error(`campaign_strategist: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'orchestration', model: env.GEMINI_MODEL, usage, runId: ctx.runId, refId: ctx.postId ?? null });
  return {
    type: 'content_calendar',
    data: parsed.data,
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(system + prompt, JSON.stringify(parsed.data)),
  };
};

// The platforms a media node is planning for, as a prompt line. Used by infographic (aspect ratio)
// and video_script (runtime budget) — both decisions are platform-dependent and were previously
// hardcoded. Falls back to a neutral hint so a platform-less goal still plans something sane.
const platformLine = (ctx: RunnerContext): string =>
  ctx.goal.platforms.length
    ? `Target platforms: ${ctx.goal.platforms.join(', ')}.`
    : 'Target platforms: unspecified — assume a square social feed post.';

// Where a video is destined, as a prompt line. Separate from platformLine because the publish
// targets and the video's cut are different questions: a post can publish to facebook while the
// video itself is cut as a TikTok vertical the user uploads by hand.
// Rhythm + aspect ONLY. These hints used to carry runtime claims ("15-30s", "under 60s", "may run
// longer") and a controlled live test showed they did nothing: same product, only the target varied,
// and every cut came back 24-26s. Runtime is now `videoLengthSec`, an explicit user choice. Leaving
// duration language here would put a second, weaker instruction in the prompt competing with it.
const VIDEO_TARGET_HINT: Record<string, string> = {
  feed: 'in-feed video, 1:1 or 4:5, opens without sound so meaning must survive muted',
  reels: 'Instagram Reels, 9:16 vertical, fast cuts, high energy',
  tiktok: 'TikTok, 9:16 vertical, hook must land in the first 2 seconds, native and unpolished',
  shorts: 'YouTube Shorts, 9:16 vertical, punchy and self-contained',
  youtube: 'YouTube landscape, 16:9, holds shots longer and breathes between beats',
};
const videoTargetLine = (ctx: RunnerContext): string => {
  const t = ctx.goal.slots.videoTarget;
  return t
    ? `Video target: ${t} — ${VIDEO_TARGET_HINT[t]}. This sets RHYTHM and ASPECT only; runtime is set separately below. Cut for THIS, not for the publish platforms.`
    : 'Video target: unspecified — cut for a short vertical social feed (rhythm and aspect only).';
};

// Veo renders 4/6/8s clips, so a target runtime bounds the shot count: you cannot reach T seconds
// with fewer than ceil(T/8) shots, nor stay within it with more than floor(T/4).
export const DEFAULT_VIDEO_LENGTH_SEC = 24;
export const shotBounds = (targetSec: number): { min: number; max: number } => ({
  min: Math.max(3, Math.ceil(targetSec / 8)),
  max: Math.max(3, Math.floor(targetSec / 4)),
});

// The runtime directive. Always emitted — when the user chose nothing we state the default
// explicitly rather than leaving the model to invent a length, which is what produced a hard 24s
// floor-and-ceiling regardless of what anyone asked for.
const videoLengthLine = (ctx: RunnerContext): string => {
  const chosen = ctx.goal.slots.videoLengthSec ?? null;
  const target = chosen ?? DEFAULT_VIDEO_LENGTH_SEC;
  const { min, max } = shotBounds(target);
  return [
    `Video runtime: TARGET ${target} seconds total${chosen ? ' — the user chose this explicitly, honour it' : ' (default; no length was requested)'}.`,
    `Use ${min} to ${max} shots so the per-shot durations (4, 6 or 8s each) sum to about ${target}s.`,
  ].join(' ');
};

// infographic (LIVE): generate a real image from the concept/strategy and attach it
// to the Post the publisher will post (heroFile = `local:<path>`). The Post is the
// single source of truth for media; the artifact just references it.
// Strip a `local:` AssetStore ref to a bare filesystem path (for edit-mode conditioning).
const localFilePath = (ref?: string | null): string | null =>
  ref ? (ref.startsWith('local:') ? ref.slice('local:'.length) : ref) : null;

// NodeCost for one generated image: real token-based cost when the API returned usageMetadata (so
// token counts are visible on the node + Usage), else the flat per-image estimate. Cached images
// are free — the caller guards on !image.cached before charging.
const imageNodeCost = (image: ImageResult): NodeCost =>
  image.usage ? costFromUsage(image.usage, 'gemini-2.5-flash-image') : imageCost();

// Until 2026-07-21 this node filled a fixed string template — same skeleton and same aesthetic
// adjectives for every product, with `no text overlay` hardcoded into a node named "infographic".
// It now PLANS the visual through the same prompt-as-data machinery storyboard uses: layout,
// on-image text, aspect ratio. Deliverable is unchanged — exactly one image, assetType 'image'.
const runInfographic = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const { system } = buildAgentPrompt('infographic', {
    language,
    userInstructions: await resolveRunInstructions(ctx, 'infographic'),
  });
  const prompt = [goalContext(ctx, language, await resolveProductKnowledge(ctx)), platformLine(ctx)].join('\n');
  let planUsage: GeminiUsage | null = null;
  const raw = await call(system, prompt, (u) => { planUsage = u; });
  const parsed = infographicBrief.omit({ imageRef: true }).safeParse(raw);
  if (!parsed.success) throw new Error(`infographic: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  const { visualBrief, imagePrompt, aspectRatio, onImageText } = parsed.data;
  if (planUsage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'infographic', model: env.GEMINI_MODEL, usage: planUsage, runId: ctx.runId, refId: ctx.postId ?? null });

  const gen = ctx.imageFn ?? ((req: ImageRequest) => generateImage(req));
  // Reference image: the post's own upload (concept gate / brief form) OR the selected product's
  // library image — generate FROM it (edit mode) so the infographic follows the reference; else
  // pure text-to-image (default).
  const refPath = await resolveReferenceImage(ctx);
  const image = await gen(refPath ? { prompt: imagePrompt, mode: 'edit', referenceImagePath: refPath } : { prompt: imagePrompt, mode: 'text-to-image' });
  const ref = `local:${image.outputFile}`;
  if (ctx.postId) {
    // A single infographic image → assetType 'image' (exactly-1-asset publish validation).
    const updated = await attachPostMedia(ctx.postId, ctx.ownerId, 'image', ref);
    if (!updated) throw new Error('infographic: could not attach image to post (locked or not found)');
  }
  // A cached image cost nothing to regenerate; a fresh one bills the real image tokens (visible on
  // the node + Usage) when the API returned usageMetadata, else the flat per-image price. Ledger
  // record fires ONLY for a real (non-cached) generation — one row per physical image call.
  const imgCost = imageNodeCost(image);
  if (!image.cached) {
    if (image.usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'infographic', model: 'gemini-2.5-flash-image', usage: image.usage, runId: ctx.runId, refId: ctx.postId ?? null });
    else await recordMediaCost({ ownerId: ctx.ownerId, surface: 'infographic', model: 'gemini-2.5-flash-image', costUsd: imgCost.costUsd, runId: ctx.runId, refId: ctx.postId ?? null });
  }
  // Node cost = the planning call + the image. Previously only the image, because there was no
  // planning call to account for.
  const planCost = planUsage ? costFromUsage(planUsage, env.GEMINI_MODEL) : estimateLlmCost(system + prompt, JSON.stringify(parsed.data));
  return {
    type: 'infographic_brief',
    data: { visualBrief, imagePrompt, imageRef: ref, aspectRatio, onImageText },
    cost: sumCost(planCost, image.cached ? undefined : imgCost),
  };
};

// storyboard (LIVE): plan 3-6 frames (LLM) then GENERATE a real image per frame. The artifact
// carries the frame images so the review UI shows a gallery, not a script. Order = plan order.
const runStoryboard = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const concept = ctx.upstream.content_concept as
    | { mainAngle?: string; keyMessage?: string; copy?: { body?: string } }
    | undefined;
  // Load the post once: it drives BOTH the setup language and the deliverable branch below.
  const post = ctx.postId ? await getPostForCopyGen(ctx.postId, ctx.ownerId) : null;
  const effectiveLang = post
    ? resolveCopyConfig(post).language
    : (ctx.goal.slots.language?.trim() || (await getUserById(ctx.ownerId))?.defaultLanguage || 'en');
  // Storyboard intent depends on the media the user chose when editing the post:
  //   carousel → each frame is a STANDALONE slide the viewer swipes through; together they tell
  //              the product story. Full, polished marketing images (not movie stills).
  //   video    → frames are KEYFRAMES that get animated + stitched into ONE continuous video.
  // Carousel if ANY target needs a carousel (per-platform asset types, item 5) — carousel
  // slides are standalone images the video step can still animate if a video target coexists.
  const isCarousel = post ? distinctAssetTypes(post).includes('carousel') : false;
  // Ground storyboard prompts on the SELECTED product (FK chain: post→campaign→brandContext→goal),
  // same as infographic/video — a per-post product choice must reach the frames, not just the copy.
  const knowledge = await resolveProductKnowledge(ctx);
  const parts = [goalContext(ctx, effectiveLang, knowledge)];
  parts.push(isCarousel
    ? 'DELIVERABLE = CAROUSEL: each frame is a STANDALONE slide the viewer swipes through; together they tell the product story start → finish. Make each a complete, self-contained marketing image, not a movie still.'
    : 'DELIVERABLE = VIDEO: these frames are KEYFRAMES that will be ANIMATED with motion and stitched in sequence. Plan them as consecutive moments of ONE continuous shot/story so the motion between frames flows.');
  parts.push(`Write every caption in this language: ${effectiveLang}. This is the ${isCarousel ? 'slide caption' : 'video voiceover'} language and must match the post copy.`);
  if (concept?.keyMessage) parts.push(`Key message: ${concept.keyMessage}`);
  if (concept?.mainAngle) parts.push(`Main angle: ${concept.mainAngle}`);
  const planPrompt = parts.join('\n');
  // Carousel → business-explainer slides; video → cinematic keyframes. One builder, two output
  // contracts selected by the deliverable (the expert base + language rule are shared).
  const { system: sbPrompt } = buildAgentPrompt('storyboard', {
    language: effectiveLang,
    contractKey: isCarousel ? 'storyboard_carousel' : 'storyboard',
    userInstructions: await resolveRunInstructions(ctx, 'storyboard'),
  });
  let planUsage: GeminiUsage | null = null;
  const raw = (await call(sbPrompt, planPrompt, (u) => { planUsage = u; })) as {
    frames?: Array<{ index?: number; imagePrompt?: string; caption?: string }>;
  };
  const plan = Array.isArray(raw?.frames) ? raw.frames : [];
  if (plan.length === 0) throw new Error('storyboard: LLM returned no frames');
  if (planUsage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'storyboard', model: env.GEMINI_MODEL, usage: planUsage, runId: ctx.runId, refId: ctx.postId ?? null });

  const gen = ctx.imageFn ?? ((req: ImageRequest) => generateImage(req));
  let cost: NodeCost = planUsage ? costFromUsage(planUsage, env.GEMINI_MODEL) : estimateLlmCost(sbPrompt + planPrompt, JSON.stringify(raw));
  const frames: Array<{ index: number; imageRef: string; caption: string; imagePrompt: string }> = [];
  // Visual consistency: the FIRST successful frame becomes a style/product anchor; every later
  // frame is generated in 'edit' mode conditioned on it, so the product + look stay coherent
  // across the storyboard instead of drifting per independent gen. A user-uploaded reference
  // image (concept gate) seeds the anchor so EVERY frame — including the first — follows it.
  let anchor: string | null =
    localFilePath(post?.referenceImage) ??
    localFilePath(await resolveLinkedReferenceImage(ctx.ownerId, post?.productKnowledgeId ?? null, post?.campaign.productKnowledgeId ?? null));
  for (const [i, f] of plan.entries()) {
    const imagePrompt = (f.imagePrompt ?? '').trim() || `Product image, frame ${i + 1}`;
    try {
      const req: ImageRequest = anchor
        ? { prompt: imagePrompt, mode: 'edit', referenceImagePath: anchor }
        : { prompt: imagePrompt, mode: 'text-to-image' };
      const image = await gen(req);
      if (!anchor) anchor = image.outputFile;
      frames.push({ index: f.index ?? i, imageRef: `local:${image.outputFile}`, caption: f.caption ?? '', imagePrompt });
      if (!image.cached) {
        const frameCost = imageNodeCost(image);
        cost = sumCost(cost, frameCost);
        // One ledger row per real generated frame (cached frames made no provider call). Real image
        // tokens when the API reported them (visible on node + Usage), else the flat per-image price.
        if (image.usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'storyboard', model: 'gemini-2.5-flash-image', usage: image.usage, runId: ctx.runId, refId: ctx.postId ?? null });
        else await recordMediaCost({ ownerId: ctx.ownerId, surface: 'storyboard', model: 'gemini-2.5-flash-image', costUsd: frameCost.costUsd, runId: ctx.runId, refId: ctx.postId ?? null });
      }
    } catch (e) {
      // The image model is intermittently flaky (returns 200 with no image ~1/3). Skip a
      // failed frame rather than fail the whole storyboard — keep the frames that rendered.
      logger.warn('storyboard_frame_failed', { index: i, error: String(e).slice(0, 160) });
    }
  }
  if (frames.length === 0) throw new Error('storyboard: no frames could be generated (image model returned nothing)');

  const parsed = storyboard.safeParse({ frames });
  if (!parsed.success) throw new Error(`storyboard: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);

  // Carousel deliverable: the storyboard frames ARE the slides → publish them as the carousel
  // (CSV of local refs, ≥2 → satisfies the carousel publish validation). For a video post the
  // frames are keyframes and the video step sets the stitched-video hero instead.
  if (isCarousel && ctx.postId && frames.length >= 1) {
    const csv = frames.map((f) => f.imageRef).join(',');
    await attachPostMedia(ctx.postId, ctx.ownerId, 'carousel', csv);
  }

  return { type: 'storyboard', data: parsed.data, cost };
};

// Veo renders only these clip lengths; anything else snaps to the nearest.
const VEO_DURATIONS = [4, 6, 8] as const;
const snapDuration = (d: number): (typeof VEO_DURATIONS)[number] =>
  VEO_DURATIONS.includes(d as (typeof VEO_DURATIONS)[number])
    ? (d as (typeof VEO_DURATIONS)[number])
    : VEO_DURATIONS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), 8);

// video_script (LIVE — 2026-07-21): plan the video BEFORE any pixel is rendered. Pure LLM, no media
// spend, no gate — the cost gate stays on `video` downstream where Veo actually charges.
//
// Why this node exists: `video` used to read `storyboard` frames, which describe STILL compositions
// and carry captions written for images. It fed that still-description to a motion model and spoke
// the image captions aloud. Motion and speech are different jobs from framing, so they get their own
// planner rather than being inferred from an artifact that never encoded them.
const runVideoScript = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const { system } = buildAgentPrompt('video_script', {
    language,
    userInstructions: await resolveRunInstructions(ctx, 'video_script'),
  });
  const prompt = [goalContext(ctx, language, await resolveProductKnowledge(ctx)), platformLine(ctx), videoTargetLine(ctx), videoLengthLine(ctx)].join('\n');
  let usage: GeminiUsage | null = null;
  const raw = await call(system, prompt, (u) => { usage = u; });
  const parsed = videoScript.safeParse(raw);
  if (!parsed.success) throw new Error(`video_script: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'video_script', model: env.GEMINI_MODEL, usage, runId: ctx.runId, refId: ctx.postId ?? null });

  // Normalise rather than trust: renumber shots in playback order and recompute the total from the
  // parts. A model that miscounts its own arithmetic would otherwise quote a runtime the renderer
  // never produces, and totalDurationSec is what the cost gate shows the user.
  const ordered = parsed.data.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ ...s, durationSec: snapDuration(s.durationSec) }));

  // Enforce the UPPER bound only. Every extra shot is a real keyframe + a real Veo clip, so a model
  // that returns 12 shots for a 24s target bills for a video nobody approved. The last shot carries
  // the CTA, so trimming drops from the MIDDLE and keeps hook and close intact. Under-delivery is
  // deliberately not corrected — it costs less than asked, and the gate shows the true runtime.
  const { max } = shotBounds(ctx.goal.slots.videoLengthSec ?? DEFAULT_VIDEO_LENGTH_SEC);
  const trimmed = ordered.length > max ? [...ordered.slice(0, max - 1), ordered[ordered.length - 1]!] : ordered;
  if (trimmed.length < ordered.length) {
    logger.warn('video_script_shots_trimmed', { returned: ordered.length, kept: trimmed.length, max, targetSec: ctx.goal.slots.videoLengthSec ?? DEFAULT_VIDEO_LENGTH_SEC });
  }

  const shots = trimmed.map((s, i) => ({ ...s, index: i }));
  const totalDurationSec = shots.reduce((n, s) => n + s.durationSec, 0);

  return {
    type: 'video_script',
    data: { ...parsed.data, shots, totalDurationSec },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(system + prompt, JSON.stringify(parsed.data)),
  };
};

// video (LIVE): render a keyframe per scripted shot, animate each with ITS OWN motion cue for ITS
// OWN duration, then ffmpeg-stitch them in shot order into ONE mp4 — the real deliverable. Sets it
// as the Post hero so publish + review use the video. Veo is slow/paid/rate-limited → serial.

const runVideo = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const script = ctx.upstream.video_script as
    | { shots?: Array<{ index: number; imagePrompt: string; motion: string; narration?: string; durationSec: number }> }
    | undefined;
  const shots = (script?.shots ?? []).slice().sort((a, b) => a.index - b.index);
  if (shots.length === 0) throw new Error('video: no video script to render (run the Video Script step first)');

  const genImage = ctx.imageFn ?? ((req: ImageRequest) => generateImage(req));
  const gen = ctx.videoFn ?? ((req: VideoRequest) => generateVideo(req));

  // Visual consistency, ported from runStoryboard: the FIRST successful keyframe anchors every later
  // one via edit mode, so the product and look don't drift shot to shot. A user-uploaded reference
  // (concept gate) or the product library image seeds the anchor so even shot 0 follows it.
  let anchor: string | null = await resolveReferenceImage(ctx);

  const clipPaths: string[] = [];
  // Seconds of the clips that ACTUALLY rendered. Must be accumulated as we go, not derived from the
  // first N shots afterwards — when a middle shot fails, the surviving clips are not the leading N,
  // so slicing the script would report a runtime the file does not have.
  let renderedSec = 0;
  let cost: NodeCost | undefined;
  let failedShots = 0;

  for (const s of shots) {
    try {
      // 1. Keyframe for this shot. Veo is image-to-video, so every shot needs a still to animate.
      const keyframe = await genImage(
        anchor
          ? { prompt: s.imagePrompt, mode: 'edit', referenceImagePath: anchor }
          : { prompt: s.imagePrompt, mode: 'text-to-image' },
      );
      if (!anchor) anchor = keyframe.outputFile;
      if (!keyframe.cached) {
        const frameCost = imageNodeCost(keyframe);
        cost = sumCost(cost, frameCost);
        if (keyframe.usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'video', model: 'gemini-2.5-flash-image', usage: keyframe.usage, runId: ctx.runId, refId: ctx.postId ?? null });
        else await recordMediaCost({ ownerId: ctx.ownerId, surface: 'video', model: 'gemini-2.5-flash-image', costUsd: frameCost.costUsd, runId: ctx.runId, refId: ctx.postId ?? null });
      }

      // 2. Animate it with THIS shot's motion cue for THIS shot's duration. Both used to be
      //    hardcoded — the still-image prompt and a constant 8s.
      const durationSec = snapDuration(s.durationSec);
      const clip = await gen({ referenceImagePath: keyframe.outputFile, prompt: s.motion, durationSec });
      clipPaths.push(clip.outputFile);
      renderedSec += durationSec;
      if (!clip.cached) {
        // One ledger row per real rendered clip, priced by THIS clip's seconds (Veo is per-second).
        await recordMediaCost({ ownerId: ctx.ownerId, surface: 'video', model: VEO_MODEL_ID, costUsd: videoClipCost(1, durationSec).costUsd, runId: ctx.runId, refId: ctx.postId ?? null });
        cost = sumCost(cost, videoClipCost(1, durationSec));
      }
    } catch (e) {
      // A terminal provider stop (spent daily quota, or a depleted prepaid balance) is NOT a flaky
      // shot: it will hit every remaining shot too, so dropping it here shipped a silently truncated
      // video with no explanation. Fail the node instead, naming the cause. Resuming is nearly free
      // — veo.ts and nano-banana.ts are content-hash filesystem caches on a persisted volume, so a
      // re-run replays the finished shots as cache hits (no API call, no cost) and renders only the
      // remainder.
      if (isTerminalQuotaError(e)) {
        const done = clipPaths.length;
        logger.warn('video_quota_stop', { scope: e.scope, model: e.model, rendered: done, planned: shots.length });
        throw new QuotaExhaustedError(
          `video: ${e.message}. Stopped after rendering ${done} of ${shots.length} shots — the finished ones are ` +
            `cached, so a re-run once this is resolved calls the provider for only the remaining ${shots.length - done}.`,
          { scope: e.scope, model: e.model, quotaId: e.quotaId, retryAfterSec: e.retryAfterSec },
        );
      }
      // The image model returns 200-with-no-image ~1/3 of the time. Drop the shot rather than the
      // whole video — but COUNT it, so a truncated deliverable is reported instead of passing as a
      // quality problem (see `degraded` on the artifact).
      failedShots++;
      logger.warn('video_shot_failed', { index: s.index, error: String(e).slice(0, 160) });
    }
  }
  if (clipPaths.length === 0) throw new Error('video: no shots could be rendered (image or video model returned nothing)');

  let finalVideo = await (ctx.stitchFn ?? stitchClips)(clipPaths);

  // Voiceover: speak the scripted narration lines (written to be SPOKEN, in the run language) and
  // mux onto the stitched (silent) video. Previously this concatenated storyboard image captions.
  // Best-effort — a TTS/mux hiccup falls back to the silent video rather than failing the node.
  const narration = shots.map((s) => (s.narration ?? '').trim()).filter(Boolean).join(' ');
  let ttsRendered = false;
  if (narration) {
    try {
      const tts = ctx.ttsFn ?? ((req: TtsRequest) => generateTts(req));
      const audio = await tts({ text: narration });
      if (!audio.cached) {
        ttsRendered = true;
        // One ledger row per real TTS render (cached voiceover made no provider call).
        await recordMediaCost({ ownerId: ctx.ownerId, surface: 'video', model: 'gemini-2.5-flash-tts', costUsd: ttsCost().costUsd, runId: ctx.runId, refId: ctx.postId ?? null });
      }
      finalVideo = await (ctx.muxFn ?? muxAudio)(finalVideo, audio.outputFile);
    } catch (e) {
      logger.warn('video_voiceover_failed', { error: String(e).slice(0, 160) });
    }
  }

  const videoRef = `local:${finalVideo}`;
  if (ctx.postId) {
    // The deliverable is ONE stitched video → assetType 'video' (single-asset publish
    // validation). For a multi-asset post this fills assetMedia.video without disturbing the
    // other platforms' media.
    const updated = await attachPostMedia(ctx.postId, ctx.ownerId, 'video', videoRef);
    if (!updated) throw new Error('video: could not attach video to post (locked or not found)');
  }

  // durationSec is now the SUM of the rendered shots, not a per-clip constant. `degraded` marks a
  // video that lost shots to a flaky media model, so the UI can say so instead of the user reading
  // a short video as poor quality.
  const parsed = videoPrompt.safeParse({
    videoRef,
    durationSec: renderedSec,
    clipCount: clipPaths.length,
    shotCount: shots.length,
    degraded: failedShots > 0,
  });
  if (!parsed.success) throw new Error(`video: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  if (failedShots > 0) logger.warn('video_degraded', { planned: shots.length, rendered: clipPaths.length, failed: failedShots });
  // Node cost = keyframes + Veo clips (accumulated per shot above) + the TTS voiceover.
  return { type: 'video_prompt', data: parsed.data, cost: sumCost(cost, ttsRendered ? ttsCost() : undefined) };
};

// ── Email path (P4-lite): email_writer drafts, email_agent sends (approval-gated) ──────────────────
const EMAIL_ADDR_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const parseRecipients = (raw?: string | null): string[] =>
  Array.from(new Set((raw ?? '').match(EMAIL_ADDR_RE) ?? [])).slice(0, 20);

const EMAIL_WRITER_PROMPT = [
  "You are Atria's Email Writer. Write ONE complete, ready-to-send email based on the user's purpose.",
  'Warm, natural, human — not templated or spammy. Plain text only (no HTML, no markdown). Keep it concise',
  '(a birthday note is 3-5 lines; a nurture email under ~150 words). One clear point. Address the recipient by',
  'first name ONLY if the purpose/context explicitly names them. NEVER derive or guess a name from the email',
  'address (the part before @ is not a name) — if no name is given, open warmly without one ("Happy birthday!").',
  'Ground in any provided context; invent no facts. Sign off warmly with',
  "no fake corporate signature. Write ENTIRELY in the requested language. Respond ONLY as JSON:",
  '{"subject":"<=120 chars","body":"plain-text email"}.',
].join(' ');

const runEmailWriter = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const to = parseRecipients(ctx.goal.slots.emailTo);
  if (!to.length) throw new Error('email_writer: no recipient email address — tell me who to send it to (an @ address).');
  // Nurture brain reply seed (Phase 03): the brain already classified + drafted + guardrailed this reply
  // (nurture-brain.ts) — use it VERBATIM, skipping the LLM call entirely, so nothing downstream can drift
  // from the decision that was actually guarded (and it costs nothing extra).
  const seededBody = ctx.goal.slots.nurtureReplyBody?.trim();
  if (seededBody) {
    return {
      type: 'email_draft',
      data: { to, subject: ctx.goal.slots.nurtureReplySubject?.trim() || 'Re: your message', body: seededBody, groundedOn: 'nurture_brain' },
    };
  }
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const concept = ctx.upstream['content_concept']; // optional grounding (a nurture flow); usually absent
  const summary = ctx.upstream['summary']; // summarize → email composition: base the email on the summary
  const research = ctx.upstream['research_summary']; // "research X, then email the findings" — ground on it
  const purpose = ctx.goal.slots.angle?.trim() || ctx.goal.slots.product?.trim() || ctx.goal.slots.emailSubject?.trim() || 'a short, friendly note';
  // Lead grounding (P3): when the recipient is a captured lead resolved by name (find_lead), enrich the
  // draft with the lead's own context — their NAME (so the writer addresses them properly), the product
  // they came in on, and their message. This personalizes a birthday/nurture note WITHOUT forcing the
  // sales-nurture framing (draftNurtureEmail's job); the purpose still drives what the email says.
  let leadGrounding = '';
  if (ctx.goal.slots.leadId) {
    const lead = await getLead(ctx.goal.slots.leadId, ctx.ownerId).catch(() => null);
    if (lead) {
      leadGrounding = [
        `Recipient name: ${lead.name ?? '(unknown — do not guess a name)'}`,
        lead.sourceProduct ? `They first showed interest in: ${lead.sourceProduct}` : '',
        lead.message ? `Their original message: ${lead.message.slice(0, 400)}` : '',
      ].filter(Boolean).join('\n');
    }
  }
  const input = [
    `Purpose / what to say: ${purpose}`,
    ctx.goal.slots.emailSubject ? `Requested subject: ${ctx.goal.slots.emailSubject}` : '',
    ctx.goal.slots.brandVoice ? `Tone: ${ctx.goal.slots.brandVoice}` : '',
    `Recipient(s): ${to.join(', ')}`,
    leadGrounding,
    concept ? `Context to ground in: ${JSON.stringify(concept).slice(0, 1200)}`
      : summary ? `Summary to base the email on: ${JSON.stringify(summary).slice(0, 1200)}`
      : research ? `Research findings to base the email on: ${JSON.stringify(research).slice(0, 1400)}` : '',
    `Write the email entirely in this language: ${language}.`,
  ].filter(Boolean).join('\n');

  let usage: GeminiUsage | null = null;
  const raw = await call(EMAIL_WRITER_PROMPT, input, (u) => { usage = u; });
  const o = (raw ?? {}) as { subject?: unknown; body?: unknown };
  const subject = (String(o.subject ?? '').trim() || ctx.goal.slots.emailSubject?.trim() || 'A note for you').slice(0, 200);
  const body = String(o.body ?? '').trim().slice(0, 8000);
  if (!body) throw new Error('email_writer: the draft came back empty — try rephrasing what the email should say.');
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'email', model: env.GEMINI_MODEL, usage, runId: ctx.runId });
  return {
    type: 'email_draft',
    data: { to, subject, body, groundedOn: concept ? 'content_concept' : summary ? 'summary' : research ? 'research_summary' : 'goal' },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(EMAIL_WRITER_PROMPT + input, body),
  };
};

// security (Data Guard) — data-protection pass over the task source text. Scans for personal/sensitive
// data (GDPR/PII), returns the source with those spans MASKED plus a plain-language notice. summarize
// `requires` this, so it always runs first and downstream sees only the masked copy. No external action.
// The example fields it returns are ALREADY MASKED (the prompt forbids echoing raw values), so no PII lands
// in the artifact. A large document is processed in full: the source is split into windows, each scanned +
// masked independently, and the masked windows are concatenated — so NO tail is silently dropped and the
// WHOLE document is protected before it reaches summarize. sourceText is capped upstream (goal-spec, 200k),
// so this is a bounded number of calls.
const SECURITY_SCAN_CHARS = 40000; // per-scan window (Gemini call granularity)

// Split text into fixed-size windows (last window may be short). Single window when it already fits.
const chunkText = (text: string, size: number): string[] => {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

// Sum Gemini usage across chunk calls so cost/usage reflects the WHOLE document, not just the last window.
const addUsage = (a: GeminiUsage | null, b: GeminiUsage | null): GeminiUsage | null => {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
  };
};
const SECURITY_PROMPT = [
  'You are Atria\'s Data Guard, a GDPR data-protection officer. Scan the SOURCE TEXT for personal or sensitive data.',
  'Categories: personal (names, dates of birth), contact (emails, phones, postal addresses), financial (card/bank/IBAN numbers),',
  'government_id (SSN, passport, national ID, tax id), health (medical/diagnosis data), credentials (passwords, API keys, tokens), other.',
  'Produce maskedText: a COPY of the source where every sensitive span is replaced by a bracketed token of its category, e.g. [CONTACT], [PERSONAL], [FINANCIAL]. Preserve all non-sensitive text verbatim.',
  'NEVER echo a raw sensitive value anywhere — not in findings, not in the notice. Any "example" must itself be masked (e.g. "j***@***").',
  'Write the notice in the SAME language as the source: state plainly what categories were found and that they were masked so they will not appear in any summary or output. If nothing sensitive is found, hasSensitive=false, findings=[], notice a short all-clear.',
  'Respond ONLY as JSON: {"hasSensitive":true,"findings":[{"category":"contact","count":2,"example":"j***@***"}],"maskedText":"...","notice":"..."}.',
].join(' ');

const SECURITY_CATEGORIES = new Set(['personal', 'contact', 'financial', 'government_id', 'health', 'credentials', 'other']);

// Scan + mask ONE window. Fail CLOSED per window: sensitive-but-unmasked throws rather than leak raw source.
interface SecurityWindow { maskedText: string; findings: { category: string; count: number; example: string }[]; hasSensitive: boolean; usage: GeminiUsage | null }
const scanSecurityWindow = async (call: LlmJsonFn, window: string): Promise<SecurityWindow> => {
  const input = `SOURCE TEXT:\n${window}`;
  let usage: GeminiUsage | null = null;
  const raw = await call(SECURITY_PROMPT, input, (u) => { usage = u; });
  const o = (raw ?? {}) as { hasSensitive?: unknown; findings?: unknown; maskedText?: unknown };
  const findings = Array.isArray(o.findings)
    ? o.findings.map((f) => {
        const ff = (f ?? {}) as { category?: unknown; count?: unknown; example?: unknown };
        const category = SECURITY_CATEGORIES.has(String(ff.category)) ? String(ff.category) : 'other';
        return { category, count: Math.max(0, Math.trunc(Number(ff.count) || 1)), example: String(ff.example ?? '').slice(0, 40) };
      }).slice(0, 20)
    : [];
  const hasSensitive = Boolean(o.hasSensitive) || findings.length > 0;
  const maskedRaw = typeof o.maskedText === 'string' ? o.maskedText : '';
  if (hasSensitive && !maskedRaw.trim()) {
    throw new Error('security: sensitive data was detected but masking failed — refusing to pass the raw source downstream.');
  }
  // A clean window (nothing sensitive) safely falls back to its verbatim text.
  return { maskedText: maskedRaw.trim() ? maskedRaw : window, findings, hasSensitive, usage };
};

const runSecurity = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const source = (ctx.goal.slots.sourceText ?? '').trim();
  if (!source) throw new Error('security: no source text to scan — provide the document or text to protect.');
  const call = ctx.llmJsonFn ?? callGeminiJson;
  // Full-document coverage: scan every window sequentially and concatenate the masked output. Every window
  // is fail-closed, so the WHOLE document is masked — nothing beyond the first window slips through unmasked
  // or gets silently dropped.
  const windows = chunkText(source, SECURITY_SCAN_CHARS);
  const maskedParts: string[] = [];
  const byCategory = new Map<string, { category: string; count: number; example: string }>();
  let hasSensitive = false;
  let usage: GeminiUsage | null = null;
  for (const w of windows) {
    const r = await scanSecurityWindow(call, w);
    maskedParts.push(r.maskedText);
    hasSensitive = hasSensitive || r.hasSensitive;
    usage = addUsage(usage, r.usage);
    for (const f of r.findings) {
      const prev = byCategory.get(f.category);
      if (prev) prev.count += f.count;
      else byCategory.set(f.category, { ...f });
    }
  }
  const findings = [...byCategory.values()].slice(0, 20);
  const maskedText = maskedParts.join('');
  const notice = (hasSensitive
    ? 'Personal or sensitive data was detected and masked before summarizing.'
    : 'No personal or sensitive data detected.')
    + (windows.length > 1 ? ` (Scanned the full document in ${windows.length} passes.)` : '');
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'security', model: env.GEMINI_MODEL, usage, runId: ctx.runId });
  if (hasSensitive) logger.info('security_masked', { runId: ctx.runId, windows: windows.length, categories: findings.map((f) => f.category) });
  return {
    type: 'security_scan',
    data: { hasSensitive, findings, maskedText, notice },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(SECURITY_PROMPT + source.slice(0, SECURITY_SCAN_CHARS), maskedText),
  };
};

// summarize (P1b Phase 05) — condenses the task source into a summary + bullets. It reads the MASKED copy
// produced upstream by the security node (data protection by default), falling back to the raw goal source
// only if no scan ran. So no personal/sensitive data reaches the summary.
const SUMMARIZE_CHARS = 20000; // per-summarize window
const SUMMARIZE_PROMPT = [
  "You are Atria's Summarizer. Read the SOURCE TEXT and write a faithful, concise summary of it.",
  'Capture the core thesis and the few points that matter; drop filler. Invent NOTHING not in the source.',
  'The source may contain [CATEGORY] tokens where sensitive data was masked — keep them as-is; never guess what they hid.',
  'Write in the SAME language as the source. Respond ONLY as JSON:',
  '{"summary":"a tight paragraph","bullets":["key point","..."]}.',
].join(' ');
// Reduce step: fold the per-section summaries into one coherent summary (map-reduce for large documents).
const SUMMARIZE_REDUCE_PROMPT = [
  "You are Atria's Summarizer. The SOURCE TEXT is an ordered set of section summaries of ONE larger document.",
  'Combine them into a single faithful, non-repetitive summary of the whole document. Invent NOTHING; keep any [CATEGORY] mask tokens as-is.',
  'Write in the SAME language as the source. Respond ONLY as JSON: {"summary":"a tight paragraph","bullets":["key point","..."]}.',
].join(' ');

interface SummaryOut { summary: string; bullets: string[]; usage: GeminiUsage | null }
const summarizeWindow = async (call: LlmJsonFn, prompt: string, text: string): Promise<SummaryOut> => {
  let usage: GeminiUsage | null = null;
  const raw = await call(prompt, `SOURCE TEXT:\n${text}`, (u) => { usage = u; });
  const o = (raw ?? {}) as { summary?: unknown; bullets?: unknown };
  const summary = String(o.summary ?? '').trim().slice(0, 8000);
  const bullets = Array.isArray(o.bullets) ? o.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 12) : [];
  return { summary, bullets, usage };
};

const runSummarize = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const scan = ctx.upstream['security_scan'] as { maskedText?: string; hasSensitive?: boolean } | undefined;
  const masked = scan?.maskedText?.trim();
  const source = (masked || (ctx.goal.slots.sourceText ?? '').trim());
  if (!source) throw new Error('summarize: no source text to summarize — give me the text or content to condense.');
  const call = ctx.llmJsonFn ?? callGeminiJson;

  let summary: string;
  let bullets: string[];
  let usage: GeminiUsage | null = null;
  if (source.length <= SUMMARIZE_CHARS) {
    const one = await summarizeWindow(call, SUMMARIZE_PROMPT, source);
    summary = one.summary; bullets = one.bullets; usage = one.usage;
  } else {
    // Map: summarize each window. Reduce: fold the section summaries into the final one. Bounded by the
    // upstream 200k sourceText cap → ~10 map calls + 1 reduce at most.
    const parts: string[] = [];
    for (const w of chunkText(source, SUMMARIZE_CHARS)) {
      const p = await summarizeWindow(call, SUMMARIZE_PROMPT, w);
      if (p.summary) parts.push(p.summary);
      usage = addUsage(usage, p.usage);
    }
    if (!parts.length) throw new Error('summarize: the summary came back empty — try again with clearer source text.');
    const reduced = await summarizeWindow(call, SUMMARIZE_REDUCE_PROMPT, parts.join('\n\n').slice(0, SUMMARIZE_CHARS * 2));
    summary = reduced.summary; bullets = reduced.bullets; usage = addUsage(usage, reduced.usage);
  }
  if (!summary) throw new Error('summarize: the summary came back empty — try again with clearer source text.');
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'summarize', model: env.GEMINI_MODEL, usage, runId: ctx.runId });
  return {
    type: 'summary',
    data: { summary, bullets, fromMaskedSource: Boolean(masked) },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(SUMMARIZE_PROMPT + source.slice(0, SUMMARIZE_CHARS), summary),
  };
};

// email_agent: send the reviewed draft via the owner's Gmail. Gated upstream (requiresApproval) so this
// only runs AFTER the user approved the draft — the no-burst rule applies to email too. Per-recipient
// outcome; a partial send (some ok, some failed) surfaces as 'partial', a total failure fails the node.
const runEmailAgent = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const draft = ctx.upstream['email_draft'] as { to?: string[]; subject?: string; body?: string } | undefined;
  let to = draft?.to?.length ? draft.to : parseRecipients(ctx.goal.slots.emailTo);
  if (!draft?.body || !to.length) throw new Error('email_agent: no reviewed draft to send.');
  const subject = draft.subject ?? 'A note for you';

  // Pre-send opt-out gate (Phase 03, HARD invariant: opt-out is ABSOLUTE + GLOBAL). Last line of
  // defense even if a stale approval slips through (e.g. a touch parked before the lead opted out) —
  // filters any recipient this owner has permanently suppressed. A wholly-suppressed send fails LOUD
  // rather than silently no-op'ing, so a human sees it instead of assuming it went out.
  const suppressedFlags = await Promise.all(to.map((addr) => isEmailSuppressed(ctx.ownerId, addr)));
  const blocked = to.filter((_, i) => suppressedFlags[i]);
  to = to.filter((_, i) => !suppressedFlags[i]);
  if (blocked.length) logger.warn('email_agent_suppressed_recipient_blocked', { runId: ctx.runId, blocked: blocked.length });
  if (!to.length) throw new Error('email_agent: recipient has opted out — send blocked.');

  // Lead Nurture Agent (Phase 02): a touch after the first reuses the SAME Gmail conversation — load
  // the thread's stored ids and carry them as threadId/In-Reply-To/References so the send collapses
  // into the existing thread instead of starting a new one (HARD invariant #6). Touch 0 has nothing
  // stored yet (gmailThreadId null) → falls through to a plain send that starts the conversation.
  const nurtureThreadId = ctx.goal.slots.nurtureThreadId;
  const nurtureThread = nurtureThreadId ? await getThreadById(nurtureThreadId) : null;
  const threading = nurtureThread?.gmailThreadId
    ? { threadId: nurtureThread.gmailThreadId, inReplyTo: nurtureThread.lastMessageId, references: nurtureThread.lastMessageId }
    : {};

  const sentIds: Record<string, string> = {};
  const threadIds: Record<string, string> = {};
  const messageIds: Record<string, string> = {};
  let lastErr: string | null = null;
  for (const addr of to) {
    // Guardrails (Phase 04): a nurture send (this run carries a nurtureThreadId) always carries a
    // signed one-click unsubscribe link — a plain birthday/personal email (no nurtureThreadId) never
    // gets the footer/header, so this stays scoped to the drip/reply flow, not every email the agent
    // can send.
    const unsubscribeUrl = nurtureThreadId ? buildUnsubscribeUrl(ctx.ownerId, addr) : null;
    const res = await sendGmailAs(ctx.ownerId, { to: addr, subject, body: draft.body, ...threading, unsubscribeUrl }, ctx.gmailSendFn);
    if (res.ok) {
      sentIds[addr] = res.id ?? 'sent';
      if (res.threadId) threadIds[addr] = res.threadId;
      if (res.messageId) messageIds[addr] = res.messageId;
    } else lastErr = res.error ?? 'send_failed';
  }
  const okCount = Object.keys(sentIds).length;
  if (okCount === 0) throw new Error(`email_agent: send failed (${lastErr ?? 'unknown'})`);
  const status = okCount < to.length ? 'partial' : 'sent';
  // Stamp the lead as nurtured (P3) when this email was addressed to a resolved lead — idempotency +
  // audit, and it flips the lead's "never contacted" state. Best-effort; a stamp failure never fails a
  // real send that already went out.
  if (ctx.goal.slots.leadId) {
    void markLeadNurtured(ctx.goal.slots.leadId, ctx.ownerId).catch(() => {});
  }
  logger.info('wf_email_sent', { runId: ctx.runId, recipients: to.length, sent: okCount, status });
  return {
    type: 'email_result',
    data: { to, subject, status, sentIds, threadIds, messageIds, error: status === 'partial' ? lastErr : null },
  };
};

// ── Wall-greeting path (Multi-channel Nurture Nodes Phase 02): greeting_writer drafts a public,
// person-directed greeting (an @mention in our own post, or a reply to theirs); greeting_agent posts
// it to every platform in goal.platforms via the greetTo fan-out (mirrors dm_writer/dm_agent, but
// multi-platform like the publisher). ─────────────────────────────────────────────────────────────
const GREETING_WRITER_PROMPT = [
  "You are Atria's Greeting Writer. Write ONE short, warm, public greeting addressed to a specific",
  'person — either an @mention in a new post, or a reply to their post. Natural and human, never',
  'templated or spammy. Plain text only, no hashtags unless the purpose asks for them, well under a',
  'normal social-post length (~200 characters is safe across platforms). Ground in any provided',
  'context; invent no facts. Write ENTIRELY in the requested language. Respond ONLY as JSON:',
  '{"body":"the greeting text"}.',
].join(' ');

// A reply target (greetPostId) already carries its own context, so it wins over a bare mention
// target (greetHandle) when a goal somehow sets both. null = neither slot filled — ask the user.
const resolveGreetingTarget = (ctx: RunnerContext): { action: 'mention' | 'reply'; target: string } | null => {
  const postId = ctx.goal.slots.greetPostId?.trim();
  if (postId) return { action: 'reply', target: postId };
  const handle = ctx.goal.slots.greetHandle?.trim();
  if (handle) return { action: 'mention', target: handle };
  return null;
};

// greeting_writer (LIVE): draft the greeting text. Grounds on an upstream content_concept/summary/
// research_summary when present, else drafts straight from the goal — mirrors runDmWriter.
const runGreetingWriter = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const resolved = resolveGreetingTarget(ctx);
  if (!resolved) throw new Error('greeting_writer: no target — tell me the @handle to mention or the post to reply to.');
  if (!ctx.goal.platforms.length) throw new Error('greeting_writer: no target platform(s) — choose at least one platform to greet on.');

  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const purpose = ctx.goal.slots.angle?.trim() || ctx.goal.slots.product?.trim() || 'a short, friendly public greeting';
  const concept = ctx.upstream['content_concept'];
  const summary = ctx.upstream['summary'];
  const research = ctx.upstream['research_summary'];
  const input = [
    `Purpose / what to say: ${purpose}`,
    ctx.goal.slots.brandVoice ? `Tone: ${ctx.goal.slots.brandVoice}` : '',
    `This is a ${resolved.action === 'reply' ? "reply to their post" : 'public @mention'} on ${ctx.goal.platforms.join(', ')} — keep it short and native to a social feed.`,
    concept ? `Context to ground in: ${JSON.stringify(concept).slice(0, 1000)}`
      : summary ? `Summary to base the greeting on: ${JSON.stringify(summary).slice(0, 1000)}`
      : research ? `Research findings to base the greeting on: ${JSON.stringify(research).slice(0, 1200)}` : '',
    `Write the greeting entirely in this language: ${language}.`,
  ].filter(Boolean).join('\n');

  let usage: GeminiUsage | null = null;
  const raw = await call(GREETING_WRITER_PROMPT, input, (u) => { usage = u; });
  const o = (raw ?? {}) as { body?: unknown };
  const body = String(o.body ?? '').trim().slice(0, 2000);
  if (!body) throw new Error('greeting_writer: the draft came back empty — try rephrasing what the greeting should say.');
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'greeting', model: env.GEMINI_MODEL, usage, runId: ctx.runId });

  const groundedOn = concept ? 'content_concept' : summary ? 'summary' : research ? 'research_summary' : 'goal';
  const parsed = greetingDraft.safeParse({ action: resolved.action, target: resolved.target, body, groundedOn });
  if (!parsed.success) throw new Error(`greeting_writer: malformed draft (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return {
    type: 'greeting_draft',
    data: parsed.data,
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(GREETING_WRITER_PROMPT + input, body),
  };
};

// greeting_agent: post the reviewed greeting to every targeted platform via the greetTo fan-out.
// Gated upstream (requiresApproval) — a public greeting is an external write, the same no-burst rule
// as publish/email/DM. Per-platform outcome (mirrors publisher's posted/partial/error); a TOTAL
// failure fails the node loudly. Idempotent per (runId, platform) via the SAME external-action audit
// log the Connector Runtime already writes for publish — no new table for this phase.
const runGreetingAgent = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const draft = ctx.upstream['greeting_draft'] as { action?: string; target?: string; body?: string } | undefined;
  const action = draft?.action;
  const target = draft?.target?.trim();
  const body = draft?.body?.trim();
  if (!action || (action !== 'mention' && action !== 'reply') || !target || !body) {
    throw new Error('greeting_agent: no reviewed draft to post.');
  }
  const platforms = ctx.goal.platforms;
  if (!platforms.length) throw new Error('greeting_agent: no target platform(s) — choose at least one platform to greet on.');

  // Global pause (kill switch, Phase 03 safety layer) — checked once up front, mirroring the
  // Connector Runtime's pre-network gate: a paused system refuses every greeting, same as a publish.
  if (await isExternalActionsPaused()) throw new Error('greeting_agent: external actions are paused.');

  const input: MentionInput | ReplyInput = action === 'mention'
    ? { ownerId: ctx.ownerId, handle: target, body }
    : { ownerId: ctx.ownerId, postId: target, body };

  const results: Array<{ platform: string; ok: boolean; url: string | null; error: string | null; degraded?: boolean; dryRun?: boolean }> = [];
  for (const platform of platforms) {
    // Idempotency (double-post guard): a re-entered/resumed run must post to a given platform AT
    // MOST ONCE — reuses the connector runtime's audit-log-backed lookup (findPriorSuccess), no new
    // table. Scoped per (runId, platform) so a partial prior run only skips what already succeeded.
    const idempotencyKey = `greet:${ctx.runId}:${platform}`;
    const prior = await findPriorSuccess(ctx.ownerId, idempotencyKey);
    if (prior) {
      logger.info('greeting_agent_already_posted', { runId: ctx.runId, platform });
      results.push({ platform, ok: true, url: prior.externalId, error: null });
      continue;
    }
    const res = await greetTo(platform, action, input, ctx.greetFn);
    results.push({ platform, ok: res.ok, url: res.url, error: res.error, degraded: res.degraded, dryRun: res.dryRun });
    await recordExternalAction({
      ownerId: ctx.ownerId,
      runId: ctx.runId,
      platform,
      actionKey: `social.${action}`,
      status: res.ok ? 'ok' : 'error',
      externalId: res.url,
      error: res.error,
      detail: { idempotencyKey },
    }).catch((e) => logger.warn('greeting_audit_write_failed', { runId: ctx.runId, platform, error: String(e).slice(0, 160) }));
  }

  const okCount = results.filter((r) => r.ok).length;
  // Fail LOUD (mirrors publisher/email_agent): nothing went out on ANY platform → the node/run must
  // surface as failed, never a silent `completed`.
  if (okCount === 0) {
    const detail = results.map((r) => `${r.platform}: ${r.error ?? 'unknown'}`).join('; ');
    throw new Error(`greeting_agent: post failed on every platform (${detail})`);
  }
  const allDryRun = results.every((r) => r.dryRun === true);
  const status = allDryRun ? 'dry_run' : okCount < platforms.length ? 'partial' : 'sent';
  logger.info('wf_greeting_posted', { runId: ctx.runId, action, platforms: platforms.length, ok: okCount, status });
  const parsed = greetingResult.safeParse({ action, target, status, results });
  if (!parsed.success) throw new Error(`greeting_agent: malformed result (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'greeting_result', data: parsed.data };
};

// scheduler (generic-scheduler node): a trivial, action-free runner. It performs NO external action —
// it only emits the marker recording the confirmed resume instant. In the normal email/publish flow the
// PARK happens in the approve path (the scheduler node is marked completed there without executing this),
// so this runner is a defensive fallback for any path that executes the node directly. It reads the
// confirmed instant off the goal; a missing/unconfirmed schedule is a planning error, so fail loud.
const runScheduler = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const sched = ctx.goal.schedule;
  if (!sched?.confirmed || !sched.at) throw new Error('scheduler: no confirmed schedule to park on');
  return {
    type: 'schedule_marker',
    data: { resumeAt: sched.at, timezone: sched.timezone ?? null, phrase: sched.phrase ?? null },
  };
};

const runners: Record<RunnableAgentId, (ctx: RunnerContext) => Promise<RunnerOutput>> = {
  ideation: runIdeation,
  strategy: runStrategy,
  content_search: runResearcher,
  campaign_strategist: runCampaignStrategist,
  concept_writer: runConceptWriter,
  infographic: runInfographic,
  storyboard: runStoryboard,
  video_script: runVideoScript,
  video: runVideo,
  publisher: runPublisher,
  email_writer: runEmailWriter,
  email_agent: runEmailAgent,
  dm_writer: runDmWriter,
  dm_agent: runDmAgent,
  greeting_writer: runGreetingWriter,
  greeting_agent: runGreetingAgent,
  scheduler: runScheduler,
  security: runSecurity,
  summarize: runSummarize,
};

export const getRunner = (agentId: RunnableAgentId) => runners[agentId];
