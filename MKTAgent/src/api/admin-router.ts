// Super-admin console API (credit-wallet Phase 03). Mounted behind requireAuth + requireSuperAdmin, so
// every handler here can trust req.userId is a super-admin. Two jobs: grant credits to tenants, and see
// the platform-wide capability-request backlog (what users asked Atria for that no node builds yet).
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, asyncHandler, parseOr422 } from './http.ts';
import { listTenantsWithBalances, grantCredits, getBalance } from '../db/repos/credit-repo.ts';
import { listAllCapabilityRequests } from '../db/repos/roadmap-demand-repo.ts';
import { getProviderSpend } from '../db/repos/provider-spend-repo.ts';
import { logger } from '../lib/logger.ts';

export const adminRouter: Router = Router();

// All tenants + balances + spend breakdown for the console table.
adminRouter.get('/tenants', asyncHandler(async (_req, res) => {
  ok(res, await listTenantsWithBalances());
}));

const grantBody = z.object({
  ownerId: z.string().uuid(),
  credits: z.number().int().positive().max(1_000_000),
  reason: z.string().trim().max(200).optional(),
});

// Grant credits to a tenant. grantedBy = the acting super-admin. Returns the tenant's new balance.
adminRouter.post('/grant', asyncHandler(async (req, res) => {
  const body = parseOr422(res, grantBody, req.body ?? {});
  if (!body) return;
  const balanceBefore = await getBalance(body.ownerId);
  // A grant to a never-seen owner would create an orphan ledger (FK would reject anyway) — guard by
  // confirming the tenant exists via its balance lookup context. grantCredits FK-cascades to mkt_user,
  // so a bad ownerId throws P2003; surface it as 404 rather than a 500.
  try {
    await grantCredits(body.ownerId, body.credits, body.reason ?? null, req.userId!);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2003') {
      return fail(res, 404, 'tenant_not_found');
    }
    throw e;
  }
  const balance = await getBalance(body.ownerId);
  logger.info('admin_grant', { by: req.userId, ownerId: body.ownerId, credits: body.credits, balance });
  ok(res, { ownerId: body.ownerId, granted: body.credits, balanceBefore, balance });
}));

// Provider spend — what WE pay Google, off the mkt_llm_usage ledger. Super-admin only by decision:
// tenants see their own credit cost, never the platform's provider bill. Reports spend and burn
// rate only — no "remaining balance", because no API exposes the Gemini prepaid balance.
adminRouter.get('/provider-spend', asyncHandler(async (_req, res) => {
  ok(res, await getProviderSpend());
}));

// Platform-wide capability-request backlog — the "build this next" board.
adminRouter.get('/capability-requests', asyncHandler(async (_req, res) => {
  ok(res, await listAllCapabilityRequests());
}));
