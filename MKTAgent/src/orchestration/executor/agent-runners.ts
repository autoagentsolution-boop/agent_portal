// AgentRunners — maps a registry agentId to the function that actually produces
// its artifact. This is the ONLY place orchestration touches the existing runtime:
//   concept_writer → materializes a Campaign+Post and calls generateForPost (live)
//   publisher      → calls publishPostNow on that Post (live; gated upstream)
//   others         → schema-valid STUB artifacts so the DAG runs end-to-end now
// No copy-gen/scheduler logic is reimplemented — only their exported cores are used.
import type { GoalSpec } from '../schemas/goal-spec.ts';
import { campaignIdeas, strategyBrief, type ArtifactType } from '../schemas/artifact-schemas.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, approveReview, setPostHeroFile } from '../../db/repos/post-repo.ts';
import { generateForPost, type GeminiFn } from '../../copygen/service.ts';
import { publishPostNow, type PublishFn } from '../../scheduler/tick.ts';
import { callGeminiJson, type LlmJsonFn } from '../master/llm-json.ts';
import { ideationSystemPrompt, strategySystemPrompt } from '../prompts/agent-prompts.ts';
import { generate as generateImage, type ImageResult } from '../../imagegen/nano-banana.ts';

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
  // Image generation seam (infographic agent). Stubbed in DRY-RUN verification so
  // no real image is generated / no API spend.
  imageFn?: (prompt: string) => Promise<ImageResult>;
  // The Post row id materialized by concept_writer, reused by publisher.
  postId?: string;
}

export interface RunnerOutput {
  type: ArtifactType;
  data: unknown;
  // concept_writer sets this so the executor stores it on ctx for publisher.
  postId?: string;
}

// concept_writer (LIVE): create a real Campaign+Post from the goal, run copy-gen,
// then auto-approve review→ready so the publisher node can claim it. The copy
// review is represented by the Post's status lifecycle, not an executor halt.
const runConceptWriter = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const { ownerId, goal } = ctx;
  const campaign = await createCampaign({
    ownerId,
    product: goal.slots.product ?? 'Untitled product',
    angle: goal.slots.angle ?? null,
    brandVoice: goal.slots.brandVoice ?? null,
    language: goal.slots.language ?? null,
    platforms: goal.platforms.length ? goal.platforms : ['facebook'],
  });
  const post = await createPost({
    campaignId: campaign.id,
    ownerId,
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
  };
};

// publisher (LIVE): publish the Post materialized by concept_writer. Gated by the
// executor's approval halt BEFORE this runs; here we just invoke the publish path.
// A stub publishFn (DRY-RUN) returns ok results without hitting any platform.
const runPublisher = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const postId = ctx.postId;
  if (!postId) throw new Error('publisher: no postId from concept_writer');
  const out = await publishPostNow(postId, ctx.ownerId, ctx.publishFn);
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
  const raw = await call(ideationSystemPrompt, goalContext(ctx));
  const parsed = campaignIdeas.safeParse(raw);
  if (!parsed.success) throw new Error(`ideation: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'campaign_ideas', data: parsed.data };
};

// strategy (LIVE): turn the chosen idea into a positioning/audience/pillars brief.
const runStrategy = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const call = ctx.llmJsonFn ?? callGeminiJson;
  const raw = await call(strategySystemPrompt, goalContext(ctx));
  const parsed = strategyBrief.safeParse(raw);
  if (!parsed.success) throw new Error(`strategy: malformed output (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'strategy_brief', data: parsed.data };
};

// Build an image prompt from the concept/strategy upstream. Falls back to the
// product when richer context is absent so the agent always has something to draw.
const buildImagePrompt = (ctx: RunnerContext): { visualBrief: string; imagePrompt: string } => {
  const { goal, upstream } = ctx;
  const concept = upstream.content_concept as { mainAngle?: string; keyMessage?: string } | undefined;
  const strat = upstream.strategy_brief as { positioning?: string; pillars?: string[] } | undefined;
  const product = goal.slots.product ?? 'the product';
  const angle = concept?.mainAngle ?? goal.slots.angle ?? product;
  const visualBrief = strat?.positioning
    ? `Marketing visual for ${product}. Positioning: ${strat.positioning}. Angle: ${angle}.`
    : `Marketing visual for ${product}. Angle: ${angle}.`;
  const pillars = strat?.pillars?.length ? ` Themes: ${strat.pillars.join(', ')}.` : '';
  const imagePrompt =
    `A high-quality, professional marketing image for a social media post about ${product}. ` +
    `${angle}.${pillars} Clean composition, vibrant, brand-friendly, no text overlay.`;
  return { visualBrief, imagePrompt };
};

// infographic (LIVE): generate a real image from the concept/strategy and attach it
// to the Post the publisher will post (heroFile = `local:<path>`). The Post is the
// single source of truth for media; the artifact just references it.
const runInfographic = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const { visualBrief, imagePrompt } = buildImagePrompt(ctx);
  const gen = ctx.imageFn ?? ((prompt: string) => generateImage({ prompt, mode: 'text-to-image' }));
  const image = await gen(imagePrompt);
  const ref = `local:${image.outputFile}`;
  if (ctx.postId) {
    const updated = await setPostHeroFile(ctx.postId, ctx.ownerId, ref);
    if (!updated) throw new Error('infographic: could not attach image to post (locked or not found)');
  }
  return { type: 'infographic_brief', data: { visualBrief, imagePrompt, imageRef: ref } };
};

// Stubs — schema-valid placeholders so the DAG completes end-to-end in M1.
const stub = (type: ArtifactType, data: unknown) => async (): Promise<RunnerOutput> => ({ type, data });

const runners: Record<RunnableAgentId, (ctx: RunnerContext) => Promise<RunnerOutput>> = {
  ideation: runIdeation,
  strategy: runStrategy,
  content_search: stub('research_summary', { summary: 'Placeholder research summary (stub agent).', sourceNotes: [] }),
  concept_writer: runConceptWriter,
  infographic: runInfographic,
  storyboard: stub('storyboard', { scenes: [{ index: 0, instruction: 'Placeholder scene (stub agent).' }], videoScript: 'placeholder script' }),
  video: stub('video_prompt', { prompt: 'Placeholder video prompt (stub agent).', durationSec: 8 }),
  publisher: runPublisher,
};

export const getRunner = (agentId: RunnableAgentId) => runners[agentId];
