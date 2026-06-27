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
    // ownerId from the JWT — never the body.
    const c = await createCampaign({ ...body, ownerId: req.userId! });
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
