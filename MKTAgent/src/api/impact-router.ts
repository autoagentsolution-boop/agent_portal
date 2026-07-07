// Impact router (Atria Phase 07) — the per-PERIOD value report (the per-campaign report lives on
// /campaigns/:id/impact). GET /impact?period=7d|30d|90d|all → real spend/output/leads for the window
// + a clearly-labeled saved-vs-agency estimate. Tenant-scoped via requireAuth.
import { Router } from 'express';
import { z } from 'zod';
import { ok, parseOr422, asyncHandler } from './http.ts';
import { metricsForPeriod } from '../impact/impact-metrics.ts';
import { buildImpactReport } from '../impact/value-model.ts';

export const impactRouter: Router = Router();

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const query = z.object({ period: z.enum(['7d', '30d', '90d', 'all']).default('30d') }).strict();

impactRouter.get('/', asyncHandler(async (req, res) => {
  const q = parseOr422(res, query, req.query ?? {});
  if (!q) return;
  // `all` → since the unix epoch (everything). Otherwise now − N days.
  const since = q.period === 'all' ? new Date(0) : new Date(Date.now() - PERIOD_DAYS[q.period]! * 86_400_000);
  const metrics = await metricsForPeriod(req.userId!, since);
  ok(res, { ...buildImpactReport('period', metrics), period: q.period });
}));
