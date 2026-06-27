// Campaigns router — read-only context for the review UI (the thin P7 slice).
// Full CRUD lands in the complete P7 build.
// TENANCY (T2): requireAuth (mounted in server.ts) guarantees req.userId; every
// query is scoped to it so a user sees only their own campaigns.
import { Router } from 'express';
import { ok, asyncHandler } from './http.ts';
import { toCampaignDto } from './mappers.ts';
import { listCampaigns } from '../db/repos/campaign-repo.ts';

export const campaignsRouter: Router = Router();

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === 'true';
    const rows = await listCampaigns(req.userId!, activeOnly);
    ok(res, rows.map(toCampaignDto), { count: rows.length, nextCursor: null });
  }),
);
