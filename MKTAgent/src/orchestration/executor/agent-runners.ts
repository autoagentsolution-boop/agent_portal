// AgentRunners — maps a registry agentId to the function that actually produces
// its artifact. This is the ONLY place orchestration touches the existing runtime:
//   concept_writer → materializes a Campaign+Post and calls generateForPost (live)
//   publisher      → calls publishPostNow on that Post (live; gated upstream)
//   others         → schema-valid STUB artifacts so the DAG runs end-to-end now
// No copy-gen/scheduler logic is reimplemented — only their exported cores are used.
import { assetTypeFromOutputs, type GoalSpec } from '../schemas/goal-spec.ts';
import { distinctAssetTypes } from '../../scheduler/resolve-input.ts';
import { resolveLinkedKnowledge, resolveLinkedReferenceImage } from '../../db/repos/product-knowledge-repo.ts';
import { campaignIdeas, strategyBrief, storyboard, videoPrompt, contentCalendar, type ArtifactType } from '../schemas/artifact-schemas.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, getPostForCopyGen, attachPostMedia, setStatus as setPostStatus } from '../../db/repos/post-repo.ts';
import { resolveCopyConfig, DEFAULT_LANGUAGE } from '../../copygen/resolve-config.ts';
import { getUserById } from '../../db/repos/user-repo.ts';
import { generateVariantsForPost, type GeminiFn } from '../../copygen/service.ts';
import { publishPostNow, type PublishFn } from '../../scheduler/tick.ts';
import { sendGmailAs, type GmailSendFn } from '../../email/gmail-send.ts';
import { getLead, markLeadNurtured } from '../../db/repos/lead-repo.ts';
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
  // Web-search seam (researcher agent — Gemini Google-Search grounding). Stubbed in
  // DRY-RUN verification so content_search spends nothing / hits no network. When unset
  // the researcher falls back to its own default grounded call (real API) then to a
  // knowledge-only summary if that call is unavailable.
  researchFn?: GroundedSearchFn;
  // Gmail send seam (email_agent). Stubbed in DRY-RUN verification so no real email is sent;
  // unset → the real owner-Gmail send.
  gmailSendFn?: GmailSendFn;
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
    platforms: goal.platforms.length ? goal.platforms : ['facebook'],
  });
  const post = await createPost({
    campaignId: campaign.id,
    ownerId,
    runId: ctx.runId, // link the post to the flow that produced it (DAG under post)
    status: 'brief',
    platforms: goal.platforms.length ? goal.platforms : ['facebook'],
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
  const platforms = ctx.goal.platforms.length ? ctx.goal.platforms : ['facebook'];
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

// Build an image prompt from the concept/strategy upstream. Two deliberately distinct
// outputs (the fix for the mixed-language + generic-image bugs):
//   - imagePrompt  → sent to nano-banana. Kept in ENGLISH on purpose: the image model is
//                    English-trained and produces best results in English. DO NOT localize
//                    this — it is not a user-facing string. Packed with real product facts
//                    (productDetails + concept + strategy) so the scene is specific, not
//                    generic cubes.
//   - visualBrief  → stored on the artifact and shown to the USER. Composed in the user's
//                    language (Vietnamese when goal.language=vi) so the brief never mixes
//                    English scaffolding around Vietnamese content.
const buildImagePrompt = (ctx: RunnerContext, resolvedLang: string, knowledge?: string | null): { visualBrief: string; imagePrompt: string } => {
  const { goal, upstream } = ctx;
  const concept = upstream.content_concept as { mainAngle?: string; keyMessage?: string } | undefined;
  const strat = upstream.strategy_brief as { positioning?: string; pillars?: string[] } | undefined;
  const product = goal.slots.product ?? 'the product';
  // Prefer resolved knowledge (goal slot → campaign brandContext from analyzed docs).
  const details = (knowledge ?? goal.slots.productDetails)?.trim();
  const angle = concept?.mainAngle ?? goal.slots.angle ?? product;
  const keyMessage = concept?.keyMessage?.trim();
  const positioning = strat?.positioning?.trim();
  const pillars = strat?.pillars?.length ? strat.pillars.join(', ') : null;
  // Setup language (post → campaign → user), NOT the chat language — the user-facing brief
  // matches the post it belongs to, even if the user chatted in another language.
  const isVi = /^vi/i.test(resolvedLang);

  // imagePrompt — ENGLISH, knowledge-rich. Subject derived from real product facts.
  const subject = details ? `${product} — ${details}` : product;
  const imagePrompt =
    `A high-quality, photorealistic marketing image for a social media post about ${subject}. ` +
    `Visual angle: ${angle}.` +
    (keyMessage ? ` Key message to evoke: ${keyMessage}.` : '') +
    (positioning ? ` Positioning: ${positioning}.` : '') +
    (pillars ? ` Themes: ${pillars}.` : '') +
    ` Clean, professional composition, vibrant and brand-friendly, no text overlay.`;

  // visualBrief — user-facing, localized. No English scaffolding when lang=vi.
  const visualBrief = isVi
    ? [
        `Hình ảnh marketing cho ${product}.`,
        details ? `Sản phẩm: ${details}.` : null,
        positioning ? `Định vị: ${positioning}.` : null,
        `Góc nhìn: ${angle}.`,
        pillars ? `Chủ đề: ${pillars}.` : null,
      ].filter(Boolean).join(' ')
    : [
        `Marketing visual for ${product}.`,
        details ? `Product: ${details}.` : null,
        positioning ? `Positioning: ${positioning}.` : null,
        `Angle: ${angle}.`,
        pillars ? `Themes: ${pillars}.` : null,
      ].filter(Boolean).join(' ');

  return { visualBrief, imagePrompt };
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

const runInfographic = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const { visualBrief, imagePrompt } = buildImagePrompt(ctx, await resolveRunLanguage(ctx), await resolveProductKnowledge(ctx));
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
  return { type: 'infographic_brief', data: { visualBrief, imagePrompt, imageRef: ref }, cost: image.cached ? undefined : imgCost };
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

// video (LIVE): animate each storyboard frame into a Veo clip, then ffmpeg-stitch them (in
// frame order) into ONE mp4 — the real deliverable. Sets it as the Post hero so publish + review
// use the video. Veo is slow/paid/rate-limited → clips are rendered serially.
const VEO_DURATIONS = [4, 6, 8] as const;
const snapDuration = (d: number): (typeof VEO_DURATIONS)[number] =>
  VEO_DURATIONS.includes(d as (typeof VEO_DURATIONS)[number])
    ? (d as (typeof VEO_DURATIONS)[number])
    : VEO_DURATIONS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a), 8);

const runVideo = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const sb = ctx.upstream.storyboard as
    | { frames?: Array<{ index: number; imageRef: string; caption?: string; imagePrompt?: string }> }
    | undefined;
  const frames = (sb?.frames ?? []).slice().sort((a, b) => a.index - b.index);
  if (frames.length === 0) throw new Error('video: no storyboard frames to animate (run storyboard first)');

  const durationSec = snapDuration(8);
  const gen = ctx.videoFn ?? ((req: VideoRequest) => generateVideo(req));

  const clipPaths: string[] = [];
  let rendered = 0;
  for (const f of frames) {
    const localPath = f.imageRef.startsWith('local:') ? f.imageRef.slice('local:'.length) : f.imageRef;
    // The frame PNG lives on disk (output/images). It can be absent if the container was
    // rebuilt/recreated without a persisted output volume — the DB still refs the hash but
    // the file is gone. Fail with an actionable message instead of a raw ENOENT so the UI
    // tells the user to re-run Storyboard (which regenerates the frames) before Video.
    try {
      await access(localPath);
    } catch {
      throw new Error('storyboard frame image is missing on disk — re-run the Storyboard step to regenerate the frames, then re-run Video');
    }
    const motionPrompt = (f.imagePrompt || f.caption || 'Subtle cinematic camera motion, gentle push-in').trim();
    const clip = await gen({ referenceImagePath: localPath, prompt: motionPrompt, durationSec });
    clipPaths.push(clip.outputFile);
    if (!clip.cached) {
      rendered++;
      // One ledger row per real rendered clip (Veo is priced per-second, not flat).
      await recordMediaCost({ ownerId: ctx.ownerId, surface: 'video', model: VEO_MODEL_ID, costUsd: videoClipCost(1, durationSec).costUsd, runId: ctx.runId, refId: ctx.postId ?? null });
    }
  }

  let finalVideo = await stitchClips(clipPaths);

  // Voiceover: narrate the frame captions (already in the campaign language) and mux the audio
  // onto the stitched (silent) video. Best-effort — a TTS/mux hiccup falls back to the silent
  // video rather than failing the whole node.
  const narration = frames.map((f) => (f.caption ?? '').trim()).filter(Boolean).join(' ');
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
      finalVideo = await muxAudio(finalVideo, audio.outputFile);
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

  const parsed = videoPrompt.safeParse({ videoRef, durationSec, clipCount: clipPaths.length });
  if (!parsed.success) throw new Error(`video: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  // Video node cost = Veo clips + the TTS voiceover (previously uncounted).
  return { type: 'video_prompt', data: parsed.data, cost: sumCost(videoClipCost(rendered), ttsRendered ? ttsCost() : undefined) };
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
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveRunLanguage(ctx);
  const concept = ctx.upstream['content_concept']; // optional grounding (a nurture flow); usually absent
  const summary = ctx.upstream['summary']; // summarize → email composition: base the email on the summary
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
      : summary ? `Summary to base the email on: ${JSON.stringify(summary).slice(0, 1200)}` : '',
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
    data: { to, subject, body, groundedOn: concept ? 'content_concept' : summary ? 'summary' : 'goal' },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(EMAIL_WRITER_PROMPT + input, body),
  };
};

// security (Data Guard) — data-protection pass over the task source text. Scans for personal/sensitive
// data (GDPR/PII), returns the source with those spans MASKED plus a plain-language notice. summarize
// `requires` this, so it always runs first and downstream sees only the masked copy. No external action.
// The example fields it returns are ALREADY MASKED (the prompt forbids echoing raw values), so no PII lands
// in the artifact. A large document is sliced to a generous window per call — full-document chunking is a
// follow-up; today the masked window is what summarize condenses.
const SECURITY_SCAN_CHARS = 40000;
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

const runSecurity = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const source = (ctx.goal.slots.sourceText ?? '').trim();
  if (!source) throw new Error('security: no source text to scan — provide the document or text to protect.');
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const windowed = source.slice(0, SECURITY_SCAN_CHARS);
  const input = `SOURCE TEXT:\n${windowed}`;
  let usage: GeminiUsage | null = null;
  const raw = await call(SECURITY_PROMPT, input, (u) => { usage = u; });
  const o = (raw ?? {}) as { hasSensitive?: unknown; findings?: unknown; maskedText?: unknown; notice?: unknown };
  // Fail CLOSED: if the model returns no maskedText, do NOT pass raw source downstream — fall back to the
  // original text ONLY when the model also reported nothing sensitive; otherwise surface the failure.
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
  const maskedText = (maskedRaw.trim() ? maskedRaw : windowed).slice(0, SECURITY_SCAN_CHARS);
  const notice = String(o.notice ?? '').trim().slice(0, 2000)
    || (hasSensitive ? 'Personal or sensitive data was detected and masked before summarizing.' : 'No personal or sensitive data detected.');
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'security', model: env.GEMINI_MODEL, usage, runId: ctx.runId });
  if (hasSensitive) logger.info('security_masked', { runId: ctx.runId, categories: findings.map((f) => f.category) });
  return {
    type: 'security_scan',
    data: { hasSensitive, findings, maskedText, notice },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(SECURITY_PROMPT + input, maskedText),
  };
};

// summarize (P1b Phase 05) — condenses the task source into a summary + bullets. It reads the MASKED copy
// produced upstream by the security node (data protection by default), falling back to the raw goal source
// only if no scan ran. So no personal/sensitive data reaches the summary.
const SUMMARIZE_PROMPT = [
  "You are Atria's Summarizer. Read the SOURCE TEXT and write a faithful, concise summary of it.",
  'Capture the core thesis and the few points that matter; drop filler. Invent NOTHING not in the source.',
  'The source may contain [CATEGORY] tokens where sensitive data was masked — keep them as-is; never guess what they hid.',
  'Write in the SAME language as the source. Respond ONLY as JSON:',
  '{"summary":"a tight paragraph","bullets":["key point","..."]}.',
].join(' ');

const runSummarize = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const scan = ctx.upstream['security_scan'] as { maskedText?: string; hasSensitive?: boolean } | undefined;
  const masked = scan?.maskedText?.trim();
  const source = (masked || (ctx.goal.slots.sourceText ?? '').trim());
  if (!source) throw new Error('summarize: no source text to summarize — give me the text or content to condense.');
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const input = `SOURCE TEXT:\n${source.slice(0, 20000)}`;
  let usage: GeminiUsage | null = null;
  const raw = await call(SUMMARIZE_PROMPT, input, (u) => { usage = u; });
  const o = (raw ?? {}) as { summary?: unknown; bullets?: unknown };
  const summary = String(o.summary ?? '').trim().slice(0, 8000);
  if (!summary) throw new Error('summarize: the summary came back empty — try again with clearer source text.');
  const bullets = Array.isArray(o.bullets) ? o.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 12) : [];
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'summarize', model: env.GEMINI_MODEL, usage, runId: ctx.runId });
  return {
    type: 'summary',
    data: { summary, bullets, fromMaskedSource: Boolean(masked) },
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(SUMMARIZE_PROMPT + input, summary),
  };
};

// email_agent: send the reviewed draft via the owner's Gmail. Gated upstream (requiresApproval) so this
// only runs AFTER the user approved the draft — the no-burst rule applies to email too. Per-recipient
// outcome; a partial send (some ok, some failed) surfaces as 'partial', a total failure fails the node.
const runEmailAgent = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const draft = ctx.upstream['email_draft'] as { to?: string[]; subject?: string; body?: string } | undefined;
  const to = draft?.to?.length ? draft.to : parseRecipients(ctx.goal.slots.emailTo);
  if (!draft?.body || !to.length) throw new Error('email_agent: no reviewed draft to send.');
  const subject = draft.subject ?? 'A note for you';

  const sentIds: Record<string, string> = {};
  let lastErr: string | null = null;
  for (const addr of to) {
    const res = await sendGmailAs(ctx.ownerId, { to: addr, subject, body: draft.body }, ctx.gmailSendFn);
    if (res.ok) sentIds[addr] = res.id ?? 'sent';
    else lastErr = res.error ?? 'send_failed';
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
  return { type: 'email_result', data: { to, subject, status, sentIds, error: status === 'partial' ? lastErr : null } };
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
  video: runVideo,
  publisher: runPublisher,
  email_writer: runEmailWriter,
  email_agent: runEmailAgent,
  scheduler: runScheduler,
  security: runSecurity,
  summarize: runSummarize,
};

export const getRunner = (agentId: RunnableAgentId) => runners[agentId];
