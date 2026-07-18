// Create a Campaign (+ optional first Post) bound to an already-saved Flow template
// (item 2, Option A). When the user, chatting on a saved flow, asks to "create campaign X
// with post Y", we ACTUALLY create it here — not just offer a button. The campaign carries
// the template goal's strategy slots; a named post clones the flow DAG (flow-as-template)
// and seeds its angle from the post title so concept_writer has a topic.
import { assetTypeFromOutputs, type GoalSpec } from '../schemas/goal-spec.ts';
import { createCampaign } from '../../db/repos/campaign-repo.ts';
import { cloneTemplateRun } from '../../db/repos/workflow-run-repo.ts';
import { createPostForOwner } from '../../db/repos/post-repo.ts';
import { getUserById } from '../../db/repos/user-repo.ts';
import type { Campaign, Post, SocialPlatform, WorkflowRun } from '../../../prisma/generated/prisma/client.ts';
import { platformsOrDefault } from '../../social/default-platforms.ts';

export interface CampaignFromFlowResult {
  campaign: Campaign;
  post: Post | null;
}

const clean = (s?: string | null): string | null => (s && s.trim() ? s.trim() : null);

// Create the campaign under the flow, then (if a post title was given) one post that
// clones the flow's DAG. All strategy fields inherit from the template goal so nothing is
// re-asked. ownerId is trusted (JWT); templateId is the saved flow's run id.
export const createCampaignFromFlow = async (
  ownerId: string,
  templateId: string,
  goal: GoalSpec,
  names: { campaignName: string | null; postTitle: string | null },
  // Per-message platform override ("chỉ facebook") — when the create message names
  // specific platforms, they win over the template goal's platforms. Empty → inherit.
  platformOverride: SocialPlatform[] = [],
): Promise<CampaignFromFlowResult> => {
  const platforms = (platformOverride.length
    ? platformOverride
    : platformsOrDefault(goal.platforms)) as SocialPlatform[];
  const product = clean(names.campaignName) ?? clean(goal.slots.product) ?? 'New campaign';
  // Never leave a campaign language-less (feedback): a null campaign language makes every post fall
  // through to the user default, which read as "ignoring the campaign". Capture the goal's language,
  // else pin the user's default NOW so the campaign carries a concrete language its posts inherit.
  const language = clean(goal.slots.language) ?? (await getUserById(ownerId))?.defaultLanguage ?? null;

  const campaign = await createCampaign({
    ownerId,
    flowId: templateId,
    product,
    angle: clean(goal.slots.angle),
    brandVoice: clean(goal.slots.brandVoice),
    brandContext: clean(goal.slots.productDetails),
    language,
    platforms,
  });

  let post: Post | null = null;
  if (clean(names.postTitle)) {
    // Clone the flow template into an executable instance run for this post (same path as
    // POST /posts). A missing/deleted template just means no runnable DAG — the post still
    // exists (legacy copy-gen). The post title seeds the angle so the concept has a topic.
    const instance: WorkflowRun | null = await cloneTemplateRun(templateId, ownerId, {
      product,
      angle: clean(names.postTitle),
      brandVoice: clean(goal.slots.brandVoice),
      language: clean(goal.slots.language),
      productDetails: clean(goal.slots.productDetails),
      platforms,
    });
    post = await createPostForOwner({
      campaignId: campaign.id,
      ownerId,
      platforms,
      language: clean(goal.slots.language) ?? undefined,
      angle: clean(names.postTitle),
      runId: instance?.id ?? null,
      // Match the flow's deliverable so the executor's media gating runs the right steps.
      assetType: assetTypeFromOutputs(goal.outputs),
    });
  }

  return { campaign, post };
};
