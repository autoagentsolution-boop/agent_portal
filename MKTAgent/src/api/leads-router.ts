// Leads router (T6) — inbound capture + tenant-scoped read.
//
// INTAKE (public, secret-gated — external funnels have no JWT):
//   POST /leads/webhook   header x-webhook-secret  → generic JSON lead
//   POST /leads/form      header x-webhook-secret  → Google-Form-style row
//   POST /leads/calcom    query  ?s=<secret>       → Cal.com BOOKING_CREATED
// READ (JWT, tenant-scoped):
//   GET  /leads                                    → this owner's leads
//
// Webhook auth is the ported n8n shared-secret model (constant-time), NOT the
// x-api-key middleware: external tools set a header/query, not our api-key. Dedupe
// + persistence + notify live in the service; the router only authenticates,
// normalizes, and maps the outcome to HTTP.
import { Router } from 'express';
import { ok, fail, asyncHandler } from './http.ts';
import { safeEqual } from '../lib/crypto.ts';
import { env } from '../config/env.ts';
import { requireAuth } from './middleware-auth.ts';
import { normalizeWebhook, normalizeForm, normalizeCalcom, type NormalizeResult } from '../leads/normalize.ts';
import { captureLead } from '../leads/service.ts';
import { listLeads } from '../db/repos/lead-repo.ts';
import { logger } from '../lib/logger.ts';
import type { Lead } from '../../prisma/generated/prisma/client.ts';

export const leadsRouter: Router = Router();

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Persist a normalized result and map outcome → HTTP. Shared by all 3 intakes.
const handleNormalized = async (
  res: Parameters<typeof ok>[0],
  result: NormalizeResult,
): Promise<void> => {
  if (!result.ok) {
    // 202 = intentionally ignored (e.g. non-booking Cal.com event), not an error.
    if (result.status === 202) return void ok(res, { status: 'ignored', reason: result.error });
    return void fail(res, result.status, result.error);
  }
  const outcome = await captureLead(result.lead);
  ok(res, { status: outcome.status, leadId: outcome.leadId ?? null });
};

// ---- POST /leads/webhook — generic JSON, header secret ----
leadsRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!env.MKT_LEAD_WEBHOOK_SECRET) return fail(res, 503, 'webhook_secret_not_configured');
    const presented = req.header('x-webhook-secret') ?? '';
    if (!safeEqual(presented, env.MKT_LEAD_WEBHOOK_SECRET)) return fail(res, 401, 'unauthorized');
    await handleNormalized(res, normalizeWebhook(asRecord(req.body)));
  }),
);

// ---- POST /leads/form — Google-Form-style row, header secret ----
leadsRouter.post(
  '/form',
  asyncHandler(async (req, res) => {
    if (!env.MKT_LEAD_WEBHOOK_SECRET) return fail(res, 503, 'webhook_secret_not_configured');
    const presented = req.header('x-webhook-secret') ?? '';
    if (!safeEqual(presented, env.MKT_LEAD_WEBHOOK_SECRET)) return fail(res, 401, 'unauthorized');
    await handleNormalized(res, normalizeForm(asRecord(req.body)));
  }),
);

// ---- POST /leads/calcom — Cal.com webhook, query secret (?s=) ----
// Cal.com signs with HMAC but lets you append query params to the webhook URL;
// the shared-secret query is the portable equivalent (ported from n8n).
leadsRouter.post(
  '/calcom',
  asyncHandler(async (req, res) => {
    if (!env.MKT_CALCOM_WEBHOOK_SECRET) return fail(res, 503, 'calcom_secret_not_configured');
    const presented = typeof req.query.s === 'string' ? req.query.s : '';
    if (!safeEqual(presented, env.MKT_CALCOM_WEBHOOK_SECRET)) return fail(res, 401, 'unauthorized');
    await handleNormalized(res, normalizeCalcom(asRecord(req.body)));
  }),
);

// ---- GET /leads — tenant-scoped read (JWT) ----
const toLeadDto = (l: Lead): Record<string, unknown> => ({
  id: l.id,
  name: l.name,
  email: l.email,
  phone: l.phone,
  message: l.message,
  sourceProduct: l.sourceProduct,
  source: l.source,
  calBookingUid: l.calBookingUid,
  receivedAt: l.receivedAt.toISOString(),
});

leadsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const leads = await listLeads(req.userId!);
    logger.info('leads_listed', { ownerId: req.userId, count: leads.length });
    ok(res, leads.map(toLeadDto), { count: leads.length });
  }),
);
