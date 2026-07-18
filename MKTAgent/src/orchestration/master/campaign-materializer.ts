// Campaign materializer (Atria Phase 04). Turns an APPROVED (user-edited) content calendar into N
// real scheduled Posts, each its own runnable flow — reusing the existing single-post machinery:
//   slot → per-slot single-scope GoalSpec → planWorkflow (registry-composed DAG, NO hand-authored
//   template) → instance run + node set → Post(runId, scheduledAt) under the campaign.
// Idempotent: a re-materialize first sweeps the campaign's UN-published posts (never a live one)
// so an edited calendar replaces the plan without duplicating or rewinding published content.
import { goalSpec, outputFlags, assetTypeFromOutputs, type GoalSpec } from '../schemas/goal-spec.ts';
import type { CalendarSlot } from '../schemas/artifact-schemas.ts';
import { planWorkflow } from './workflow-planner.ts';
import { getCampaign } from '../../db/repos/campaign-repo.ts';
import { createPostForOwner, sweepUnpublishedCampaignPosts } from '../../db/repos/post-repo.ts';
import { createRun, createNodes } from '../../db/repos/workflow-run-repo.ts';
import { scheduleCalendar } from '../../scheduler/schedule-calendar.ts';
import type { Campaign } from '../../../prisma/generated/prisma/client.ts';
import { platformsOrDefault } from '../../social/default-platforms.ts';

// Map a calendar slot's deliverable to the output flags that drive agent selection. Copy +
// publishing always on; exactly one media flag (or none for a plain text post).
const outputsForFormat = (format: CalendarSlot['format']): GoalSpec['outputs'] =>
  outputFlags.parse({
    needsTextPost: true,
    needsPublishing: true,
    needsInfographic: format === 'image',
    needsStoryboard: format === 'carousel',
    needsVideo: format === 'video',
  });

// A single-scope GoalSpec for one slot, grounded in the campaign's product/brand/language.
const goalForSlot = (campaign: Campaign, slot: CalendarSlot): GoalSpec => {
  const platforms = slot.platforms.length ? slot.platforms : platformsOrDefault(campaign.platforms);
  return goalSpec.parse({
    outputs: outputsForFormat(slot.format),
    platforms,
    campaignScope: 'single',
    slots: {
      product: campaign.product,
      productDetails: campaign.brandContext ?? undefined,
      angle: slot.angle || undefined,
      brandVoice: campaign.brandVoice ?? undefined,
      language: campaign.language ?? undefined,
    },
    provider: 'campaign-materializer',
  });
};

export interface MaterializeResult {
  campaignId: string;
  swept: number; // un-published posts replaced
  posts: Array<{ postId: string; runId: string; index: number; scheduledAt: string | null }>;
  skipped: Array<{ index: number; reason: string }>;
}

// Materialize the calendar into scheduled posts. `now` is injectable for testing. Returns null when
// the campaign is missing / wrong tenant (route → 404). A slot whose GoalSpec fails to plan is
// SKIPPED (reported), never a hard failure of the whole batch.
export async function materializeCalendar(
  campaignId: string,
  ownerId: string,
  slots: CalendarSlot[],
  opts: { now?: Date } = {},
): Promise<MaterializeResult | null> {
  const campaign = await getCampaign(campaignId, ownerId);
  if (!campaign) return null;

  const swept = await sweepUnpublishedCampaignPosts(campaignId, ownerId);

  const timings = scheduleCalendar({
    slots: slots.map((s) => ({ index: s.index, dayOffset: s.dayOffset })),
    postingWindow: campaign.postingWindow,
    timezone: campaign.timezone,
    now: opts.now ?? new Date(),
  });
  const scheduledByIndex = new Map(timings.map((t) => [t.index, t.scheduledAt]));

  const posts: MaterializeResult['posts'] = [];
  const skipped: MaterializeResult['skipped'] = [];

  for (const slot of slots) {
    const goal = goalForSlot(campaign, slot);
    const planned = planWorkflow(goal);
    if (!planned.ok) {
      skipped.push({ index: slot.index, reason: planned.error });
      continue;
    }
    const run = await createRun({ ownerId, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, ownerId, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const scheduledAt = scheduledByIndex.get(slot.index) ?? null;
    const post = await createPostForOwner({
      campaignId,
      ownerId,
      runId: run.id,
      platforms: goal.platforms,
      angle: slot.angle || null,
      language: campaign.language,
      assetType: assetTypeFromOutputs(goal.outputs),
      scheduledAt,
    });
    posts.push({ postId: post.id, runId: run.id, index: slot.index, scheduledAt: scheduledAt ? scheduledAt.toISOString() : null });
  }

  return { campaignId, swept, posts, skipped };
}
