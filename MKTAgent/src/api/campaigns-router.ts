// Campaigns router — full CRUD (T7). The campaign is the config-as-data root:
// product/angle/brandVoice/language/platforms/postingWindow drive copy-gen + the
// scheduler for every child post.
// TENANCY (T2): requireAuth (mounted in server.ts) guarantees req.userId; every
// query is scoped to it (explicit ownerId arg) so a user only ever sees/mutates
// their own campaigns. Wrong tenant → 404 (no existence leak).
import { Router } from 'express';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { createCampaignBody, updateCampaignBody } from './schemas.ts';
import { toCampaignDto } from './mappers.ts';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
} from '../db/repos/campaign-repo.ts';
import { getRunForOwner, grantAutonomyForCampaign } from '../db/repos/workflow-run-repo.ts';
import { z } from 'zod';
import { socialPlatform } from './schemas.ts';
import { materializeCalendar } from '../orchestration/master/campaign-materializer.ts';
import { estimateCampaignCost, campaignStatusRollup } from '../orchestration/master/campaign-grant.ts';
import { issueCampaignGrantToken, verifyCampaignGrantToken } from './autonomy-grant-token.ts';
import type { CalendarSlot } from '../orchestration/schemas/artifact-schemas.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';
import { logRun } from '../db/client.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { metricsForCampaign } from '../impact/impact-metrics.ts';
import { buildImpactReport } from '../impact/value-model.ts';

export const campaignsRouter: Router = Router();

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === 'true';
    const rows = await listCampaigns(req.userId!, activeOnly);
    ok(res, rows.map(toCampaignDto), { count: rows.length, nextCursor: null });
  }),
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await getCampaign(req.params.id, req.userId!);
    if (!c) return fail(res, 404, 'campaign_not_found');
    ok(res, toCampaignDto(c));
  }),
);

campaignsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, createCampaignBody, req.body ?? {});
    if (!body) return;
    // If attaching to a flow, it must be the caller's own flow (tenancy) — else 404
    // so a user can't graft a campaign onto another tenant's run.
    const flow = body.flowId ? await getRunForOwner(body.flowId, req.userId!) : null;
    if (body.flowId && !flow) {
      return fail(res, 404, 'flow_not_found');
    }
    // Inherit the parent flow's platforms/strategy when the create request omits them, so a
    // campaign set up under a saved flow keeps its FULL platform set instead of collapsing to
    // empty/Facebook (bug 2026-07-13: "MonthPlan-Atria" campaign persisted platforms=[] under an
    // all-5-platform flow → every post then defaulted to Facebook-only). The final fallback
    // guarantees a campaign is never platform-less, matching createCampaignFromFlow / the strategist.
    const parsedFlowGoal = flow ? goalSpec.safeParse(flow.goal) : null;
    const flowGoal = parsedFlowGoal?.success ? parsedFlowGoal.data : null;
    const platforms = (body.platforms?.length
      ? body.platforms
      : flowGoal?.platforms.length
        ? flowGoal.platforms
        : ['facebook']) as SocialPlatform[];
    // ownerId from the JWT — never the body.
    const c = await createCampaign({
      ...body,
      ownerId: req.userId!,
      platforms,
      language: body.language ?? flowGoal?.slots.language ?? null,
      brandVoice: body.brandVoice ?? flowGoal?.slots.brandVoice ?? null,
      angle: body.angle ?? flowGoal?.slots.angle ?? null,
      brandContext: body.brandContext ?? flowGoal?.slots.productDetails ?? null,
    });
    res.status(201);
    ok(res, toCampaignDto(c));
  }),
);

campaignsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, updateCampaignBody, req.body ?? {});
    if (!body) return;
    // Scoped updateMany guard returns null for not-found / wrong-tenant → 404.
    const c = await updateCampaign(req.params.id, req.userId!, body);
    if (!c) return fail(res, 404, 'campaign_not_found');
    ok(res, toCampaignDto(c));
  }),
);

campaignsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    // Cascades to child posts (FK onDelete: Cascade). false → not owned → 404.
    if (!(await deleteCampaign(req.params.id, req.userId!)))
      return fail(res, 404, 'campaign_not_found');
    res.status(204).end();
  }),
);

// Materialize an approved (user-edited) content calendar into N scheduled posts (Atria Phase 04).
// The client sends the reviewed calendar slots; each becomes a Post + its own runnable DAG, spread
// across the campaign's posting window. Idempotent: re-materializing sweeps the un-published posts
// and replaces them, never touching a published one.
const materializeSlot = z.object({
  index: z.number().int().nonnegative(),
  pillar: z.string().max(400).default(''),
  angle: z.string().max(2000).default(''),
  format: z.enum(['text', 'image', 'carousel', 'video']).default('image'),
  platforms: z.array(socialPlatform).default([]),
  hook: z.string().max(1000).default(''),
  rationale: z.string().max(2000).default(''),
  dayOffset: z.number().int().nonnegative().default(0),
});
const materializeBody = z.object({ slots: z.array(materializeSlot).min(1).max(120) }).strict();

campaignsRouter.post(
  '/:id/materialize',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, materializeBody, req.body ?? {});
    if (!body) return;
    const result = await materializeCalendar(req.params.id, req.userId!, body.slots as CalendarSlot[]);
    if (!result) return fail(res, 404, 'campaign_not_found');
    ok(res, result);
  }),
);

// Live status rollup of a campaign's materialized posts (Phase 05) — the command board reads this.
campaignsRouter.get(
  '/:id/status',
  asyncHandler(async (req, res) => {
    if (!(await getCampaign(req.params.id, req.userId!))) return fail(res, 404, 'campaign_not_found');
    ok(res, await campaignStatusRollup(req.params.id, req.userId!));
  }),
);

// Impact / value report for one campaign (Phase 07): real cost/output/leads + a clearly-labeled
// saved-vs-agency estimate. The retention/sales proof-of-value screen reads this.
campaignsRouter.get(
  '/:id/impact',
  asyncHandler(async (req, res) => {
    if (!(await getCampaign(req.params.id, req.userId!))) return fail(res, 404, 'campaign_not_found');
    const metrics = await metricsForCampaign(req.params.id, req.userId!);
    ok(res, buildImpactReport('campaign', metrics));
  }),
);

// Campaign-level autonomy grant (Phase 05). ONE backend-enforced double-confirm authorizes EVERY
// materialized post's run to run autonomously. Step 1 (no token) returns the whole-calendar cost
// estimate + status + a confirmationToken WITHOUT granting; step 2 (echo token) flips all runs to
// 'atria' in one audited action. Per-post guardrails still gate each external write at run time.
campaignsRouter.post(
  '/:id/grant-autonomy',
  asyncHandler(async (req, res) => {
    const campaign = await getCampaign(req.params.id, req.userId!);
    if (!campaign) return fail(res, 404, 'campaign_not_found');
    const body = (req.body ?? {}) as { confirmationToken?: unknown; scheduleConfirmed?: unknown };

    const estimate = await estimateCampaignCost(campaign.id, req.userId!);
    // Step 1 — no valid token: surface the cost up front + issue the token, DO NOT grant.
    if (!verifyCampaignGrantToken(campaign.id, req.userId!, body.confirmationToken)) {
      const status = await campaignStatusRollup(campaign.id, req.userId!);
      return ok(res, {
        campaignId: campaign.id,
        pendingConfirmation: true,
        confirmationToken: issueCampaignGrantToken(campaign.id, req.userId!),
        estimate,
        status,
      });
    }

    // Optional hard ceiling: the per-run ceiling scaled by post count (a runaway avg per-post blocks).
    const totalCeiling = env.ATRIA_AUTONOMY_COST_CEILING_USD * Math.max(1, estimate.posts);
    if (totalCeiling > 0 && estimate.costUsd > totalCeiling) {
      return fail(res, 409, 'campaign_over_cost_ceiling', { estimatedUsd: estimate.costUsd, ceilingUsd: totalCeiling });
    }

    // Step 2 — token verified: grant the whole campaign in one audited action.
    const scheduleConfirmed = body.scheduleConfirmed === true;
    const { granted } = await grantAutonomyForCampaign(campaign.id, req.userId!, scheduleConfirmed);
    await logRun('info', 'atria_campaign_grant', { campaignId: campaign.id, granted, scheduleConfirmed }, req.userId!);
    logger.info('wf_campaign_autonomy_granted', { campaignId: campaign.id, granted, scheduleConfirmed });
    const status = await campaignStatusRollup(campaign.id, req.userId!);
    ok(res, { campaignId: campaign.id, granted, scheduleConfirmed, estimate, status });
  }),
);
