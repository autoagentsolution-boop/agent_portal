// AgentRunners — maps a registry agentId to the function that actually produces
// its artifact. This is the ONLY place orchestration touches the existing runtime:
//   concept_writer → materializes a Campaign+Post and calls generateForPost (live)
//   publisher      → calls publishPostNow on that Post (live; gated upstream)
//   others         → schema-valid STUB artifacts so the DAG runs end-to-end now
// No copy-gen/scheduler logic is reimplemented — only their exported cores are used.
import type { GoalSpec } from '../schemas/goal-spec.ts';
import type { ArtifactType } from '../schemas/artifact-schemas.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, approveReview } from '../../db/repos/post-repo.ts';
import { generateForPost, type GeminiFn } from '../../copygen/service.ts';
import { publishPostNow, type PublishFn } from '../../scheduler/tick.ts';

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

// Stubs — schema-valid placeholders so the DAG completes end-to-end in M1.
const stub = (type: ArtifactType, data: unknown) => async (): Promise<RunnerOutput> => ({ type, data });

const runners: Record<RunnableAgentId, (ctx: RunnerContext) => Promise<RunnerOutput>> = {
  content_search: stub('research_summary', { summary: 'Placeholder research summary (stub agent).', sourceNotes: [] }),
  concept_writer: runConceptWriter,
  infographic: stub('infographic_brief', { visualBrief: 'Placeholder visual brief (stub agent).', imagePrompt: 'placeholder image prompt' }),
  storyboard: stub('storyboard', { scenes: [{ index: 0, instruction: 'Placeholder scene (stub agent).' }], videoScript: 'placeholder script' }),
  video: stub('video_prompt', { prompt: 'Placeholder video prompt (stub agent).', durationSec: 8 }),
  publisher: runPublisher,
};

export const getRunner = (agentId: RunnableAgentId) => runners[agentId];
