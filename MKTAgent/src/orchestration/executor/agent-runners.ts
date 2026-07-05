// AgentRunners — maps a registry agentId to the function that actually produces
// its artifact. This is the ONLY place orchestration touches the existing runtime:
//   concept_writer → materializes a Campaign+Post and calls generateForPost (live)
//   publisher      → calls publishPostNow on that Post (live; gated upstream)
//   others         → schema-valid STUB artifacts so the DAG runs end-to-end now
// No copy-gen/scheduler logic is reimplemented — only their exported cores are used.
import type { GoalSpec } from '../schemas/goal-spec.ts';
import { campaignIdeas, strategyBrief, storyboard, videoPrompt, type ArtifactType } from '../schemas/artifact-schemas.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, approveReview, setPostHeroFile, setStatus as setPostStatus } from '../../db/repos/post-repo.ts';
import { generateForPost, type GeminiFn } from '../../copygen/service.ts';
import { publishPostNow, type PublishFn } from '../../scheduler/tick.ts';
import { callGeminiJson, type LlmJsonFn } from '../master/llm-json.ts';
import { ideationSystemPrompt, strategySystemPrompt, storyboardSystemPrompt } from '../prompts/agent-prompts.ts';
import { generate as generateImage, type ImageResult, type ImageRequest } from '../../imagegen/nano-banana.ts';
import { generate as generateVideo, type VideoRequest, type VideoResult } from '../../video/veo.ts';
import { generate as generateTts, type TtsRequest } from '../../video/tts.ts';
import { stitchClips, muxAudio } from '../../video/stitch.ts';
import { runtimePublishFn } from '../../connectors/runtime/connector-runtime.ts';
import { logger } from '../../lib/logger.ts';
import { estimateLlmCost, imageCost, videoClipCost, sumCost, type NodeCost } from './node-cost.ts';

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

// concept_writer instance path (LIVE): the Post already exists (created before the run,
// post.runId = this run) and its Campaign already carries the merged strategy. We only
// run copy-gen on it + approve review→ready — we do NOT create a new campaign/post. This
// is the flow-as-template path: one template → many posts, each its own instance run.
const runConceptWriterForExistingPost = async (ctx: RunnerContext, postId: string): Promise<RunnerOutput> => {
  const { ownerId, goal } = ctx;
  const post = await getPostForOwner(postId, ownerId);
  if (!post) throw new Error('concept_writer: attached post not found');

  // Reset to `brief` so copy-gen runs whether this is the first execution (already brief)
  // or a re-run of a post that reached review/ready/posted (would otherwise be refused as
  // not_generatable). This is the "regenerate this step" semantics for the concept node.
  if (post.status !== 'brief' && post.status !== 'rework') {
    await setPostStatus(post.id, 'brief');
  }

  const result = await generateForPost(post.id, ownerId, ctx.geminiFn);
  if (result.status !== 'review') {
    throw new Error(`concept_writer: copy-gen did not reach review (${result.reason ?? result.error ?? result.status})`);
  }
  const row = await getPostForOwner(post.id, ownerId);
  const copy = (row?.copy as { body: string; threads: string; x: string } | null) ?? null;
  if (!copy) throw new Error('concept_writer: copy missing after review');

  await approveReview(post.id, ownerId, new Date());

  return {
    type: 'content_concept',
    postId: post.id,
    data: {
      mainAngle: goal.slots.angle ?? goal.slots.product ?? 'marketing concept',
      keyMessage: copy.body.slice(0, 200),
      copy,
      postId: post.id,
    },
    cost: estimateLlmCost(goalContext(ctx), `${copy.body}\n${copy.threads}\n${copy.x}`),
  };
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
  });

  const result = await generateForPost(post.id, ownerId, ctx.geminiFn);
  if (result.status !== 'review') {
    throw new Error(`concept_writer: copy-gen did not reach review (${result.reason ?? result.error ?? result.status})`);
  }
  const row = await getPostForOwner(post.id, ownerId);
  const copy = (row?.copy as { body: string; threads: string; x: string } | null) ?? null;
  if (!copy) throw new Error('concept_writer: copy missing after review');

  // Approve review→ready (scheduledAt=now) so publisher can claim it this run.
  await approveReview(post.id, ownerId, new Date());

  return {
    type: 'content_concept',
    postId: post.id,
    data: {
      mainAngle: goal.slots.angle ?? goal.slots.product ?? 'marketing concept',
      keyMessage: copy.body.slice(0, 200),
      copy,
      postId: post.id,
    },
    cost: estimateLlmCost(goalContext(ctx), `${copy.body}\n${copy.threads}\n${copy.x}`),
  };
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
  return {
    type: 'publish_result',
    data: {
      postId,
      status: out.status === 'posted' || out.status === 'partial' || out.status === 'error' ? out.status : 'awaiting_approval',
      postUrls: (post?.postUrls as Record<string, string> | null) ?? null,
      error: post?.error ?? null,
    },
  };
};

// Compact, language-agnostic description of the goal for the ideation/strategy LLM
// prompts. Includes upstream artifacts (research, chosen idea) when present.
const goalContext = (ctx: RunnerContext): string => {
  const { goal, upstream } = ctx;
  const lines = [
    `Product: ${goal.slots.product ?? 'Unspecified product'}`,
    goal.slots.productDetails ? `Product knowledge (use these facts, do not invent beyond them): ${goal.slots.productDetails}` : null,
    goal.slots.accountType ? `Marketer type: ${goal.slots.accountType}` : null,
    goal.slots.targetAudience ? `Audience: ${goal.slots.targetAudience}` : null,
    goal.slots.angle ? `Angle: ${goal.slots.angle}` : null,
    goal.slots.brandVoice ? `Brand voice: ${goal.slots.brandVoice}` : null,
    goal.slots.language ? `Language: ${goal.slots.language}` : null,
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
  const prompt = goalContext(ctx);
  const raw = await call(ideationSystemPrompt, prompt);
  const parsed = campaignIdeas.safeParse(raw);
  if (!parsed.success) throw new Error(`ideation: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'campaign_ideas', data: parsed.data, cost: estimateLlmCost(ideationSystemPrompt + prompt, JSON.stringify(parsed.data)) };
};

// strategy (LIVE): turn the chosen idea into a positioning/audience/pillars brief.
const runStrategy = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const prompt = goalContext(ctx);
  const raw = await call(strategySystemPrompt, prompt);
  const parsed = strategyBrief.safeParse(raw);
  if (!parsed.success) throw new Error(`strategy: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'strategy_brief', data: parsed.data, cost: estimateLlmCost(strategySystemPrompt + prompt, JSON.stringify(parsed.data)) };
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
const buildImagePrompt = (ctx: RunnerContext): { visualBrief: string; imagePrompt: string } => {
  const { goal, upstream } = ctx;
  const concept = upstream.content_concept as { mainAngle?: string; keyMessage?: string } | undefined;
  const strat = upstream.strategy_brief as { positioning?: string; pillars?: string[] } | undefined;
  const product = goal.slots.product ?? 'the product';
  const details = goal.slots.productDetails?.trim();
  const angle = concept?.mainAngle ?? goal.slots.angle ?? product;
  const keyMessage = concept?.keyMessage?.trim();
  const positioning = strat?.positioning?.trim();
  const pillars = strat?.pillars?.length ? strat.pillars.join(', ') : null;
  const isVi = /^vi/i.test(goal.slots.language ?? '');

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
const runInfographic = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const { visualBrief, imagePrompt } = buildImagePrompt(ctx);
  const gen = ctx.imageFn ?? ((req: ImageRequest) => generateImage(req));
  const image = await gen({ prompt: imagePrompt, mode: 'text-to-image' });
  const ref = `local:${image.outputFile}`;
  if (ctx.postId) {
    const updated = await setPostHeroFile(ctx.postId, ctx.ownerId, ref);
    if (!updated) throw new Error('infographic: could not attach image to post (locked or not found)');
  }
  // A cached image cost nothing to regenerate; a fresh one is the flat per-image price.
  return { type: 'infographic_brief', data: { visualBrief, imagePrompt, imageRef: ref }, cost: image.cached ? undefined : imageCost() };
};

// storyboard (LIVE): plan 3-6 frames (LLM) then GENERATE a real image per frame. The artifact
// carries the frame images so the review UI shows a gallery, not a script. Order = plan order.
const runStoryboard = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const concept = ctx.upstream.content_concept as
    | { mainAngle?: string; keyMessage?: string; copy?: { body?: string } }
    | undefined;
  const parts = [goalContext(ctx)];
  if (concept?.keyMessage) parts.push(`Key message: ${concept.keyMessage}`);
  if (concept?.mainAngle) parts.push(`Main angle: ${concept.mainAngle}`);
  const planPrompt = parts.join('\n');
  const raw = (await call(storyboardSystemPrompt, planPrompt)) as {
    frames?: Array<{ index?: number; imagePrompt?: string; caption?: string }>;
  };
  const plan = Array.isArray(raw?.frames) ? raw.frames : [];
  if (plan.length === 0) throw new Error('storyboard: LLM returned no frames');

  const gen = ctx.imageFn ?? ((req: ImageRequest) => generateImage(req));
  let cost: NodeCost = estimateLlmCost(storyboardSystemPrompt + planPrompt, JSON.stringify(raw));
  const frames: Array<{ index: number; imageRef: string; caption: string; imagePrompt: string }> = [];
  // Visual consistency: the FIRST successful frame becomes a style/product anchor; every later
  // frame is generated in 'edit' mode conditioned on it, so the product + look stay coherent
  // across the storyboard instead of drifting per independent gen.
  let anchor: string | null = null;
  for (const [i, f] of plan.entries()) {
    const imagePrompt = (f.imagePrompt ?? '').trim() || `Product image, frame ${i + 1}`;
    try {
      const req: ImageRequest = anchor
        ? { prompt: imagePrompt, mode: 'edit', referenceImagePath: anchor }
        : { prompt: imagePrompt, mode: 'text-to-image' };
      const image = await gen(req);
      if (!anchor) anchor = image.outputFile;
      frames.push({ index: f.index ?? i, imageRef: `local:${image.outputFile}`, caption: f.caption ?? '', imagePrompt });
      if (!image.cached) cost = sumCost(cost, imageCost());
    } catch (e) {
      // The image model is intermittently flaky (returns 200 with no image ~1/3). Skip a
      // failed frame rather than fail the whole storyboard — keep the frames that rendered.
      logger.warn('storyboard_frame_failed', { index: i, error: String(e).slice(0, 160) });
    }
  }
  if (frames.length === 0) throw new Error('storyboard: no frames could be generated (image model returned nothing)');

  const parsed = storyboard.safeParse({ frames });
  if (!parsed.success) throw new Error(`storyboard: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
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
    const motionPrompt = (f.imagePrompt || f.caption || 'Subtle cinematic camera motion, gentle push-in').trim();
    const clip = await gen({ referenceImagePath: localPath, prompt: motionPrompt, durationSec });
    clipPaths.push(clip.outputFile);
    if (!clip.cached) rendered++;
  }

  let finalVideo = await stitchClips(clipPaths);

  // Voiceover: narrate the frame captions (already in the campaign language) and mux the audio
  // onto the stitched (silent) video. Best-effort — a TTS/mux hiccup falls back to the silent
  // video rather than failing the whole node.
  const narration = frames.map((f) => (f.caption ?? '').trim()).filter(Boolean).join(' ');
  if (narration) {
    try {
      const tts = ctx.ttsFn ?? ((req: TtsRequest) => generateTts(req));
      const audio = await tts({ text: narration });
      finalVideo = await muxAudio(finalVideo, audio.outputFile);
    } catch (e) {
      logger.warn('video_voiceover_failed', { error: String(e).slice(0, 160) });
    }
  }

  const videoRef = `local:${finalVideo}`;
  if (ctx.postId) {
    const updated = await setPostHeroFile(ctx.postId, ctx.ownerId, videoRef);
    if (!updated) throw new Error('video: could not attach video to post (locked or not found)');
  }

  const parsed = videoPrompt.safeParse({ videoRef, durationSec, clipCount: clipPaths.length });
  if (!parsed.success) throw new Error(`video: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'video_prompt', data: parsed.data, cost: videoClipCost(rendered) };
};

// Stubs — schema-valid placeholders so the DAG completes end-to-end in M1.
const stub = (type: ArtifactType, data: unknown) => async (): Promise<RunnerOutput> => ({ type, data });

const runners: Record<RunnableAgentId, (ctx: RunnerContext) => Promise<RunnerOutput>> = {
  ideation: runIdeation,
  strategy: runStrategy,
  content_search: stub('research_summary', { summary: 'Placeholder research summary (stub agent).', sourceNotes: [] }),
  concept_writer: runConceptWriter,
  infographic: runInfographic,
  storyboard: runStoryboard,
  video: runVideo,
  publisher: runPublisher,
};

export const getRunner = (agentId: RunnableAgentId) => runners[agentId];
