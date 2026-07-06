// Leads router (T6 + Atria §01.1 per-tenant intake).
//
// INTAKE (public — external funnels have no JWT). The OWNER is resolved from a presented
// PER-OWNER intake token (header `x-intake-token` or query `?t=`) → the lead lands on the
// right tenant. The legacy global shared secret still works and maps to the SYSTEM owner
// (back-compat for the DAIS funnels):
//   POST /leads/webhook   x-intake-token | x-webhook-secret  → generic JSON lead
//   POST /leads/form      x-intake-token | x-webhook-secret  → Google-Form-style row
//   POST /leads/calcom    ?t=<intake> | ?s=<secret>          → Cal.com BOOKING_CREATED
// MANAGE + READ (JWT, tenant-scoped):
//   POST   /leads/intake-tokens     → mint a token (plaintext returned ONCE)
//   GET    /leads/intake-tokens     → list this owner's tokens (metadata only)
//   DELETE /leads/intake-tokens/:id → revoke
//   GET    /leads                   → this owner's leads
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { safeEqual } from '../lib/crypto.ts';
import { env } from '../config/env.ts';
import { requireAuth } from './middleware-auth.ts';
import { normalizeWebhook, normalizeForm, normalizeCalcom, type NormalizeResult } from '../leads/normalize.ts';
import { captureLead } from '../leads/service.ts';
import { listLeads, type DecryptedLead } from '../db/repos/lead-repo.ts';
import { resolveOwnerByToken, createIntakeToken, listIntakeTokens, revokeIntakeToken } from '../db/repos/lead-intake-token-repo.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import { logger } from '../lib/logger.ts';

export const leadsRouter: Router = Router();

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// Resolve the owner for an inbound intake. Per-owner intake token wins (header or query);
// else the legacy global secret → SYSTEM owner. Returns null → the caller 401s. NEVER logs
// the token value. `legacySecret` is the matching global secret for that route (or null).
const resolveIntakeOwner = async (
  req: { header: (n: string) => string | undefined; query: Record<string, unknown> },
  legacySecret: string | null,
): Promise<string | null> => {
  const presentedToken = req.header('x-intake-token') ?? (typeof req.query.t === 'string' ? req.query.t : '');
  if (presentedToken) return resolveOwnerByToken(presentedToken);
  // Legacy global-secret path (DAIS funnels) → system owner.
  if (legacySecret) {
    const presentedSecret = req.header('x-webhook-secret') ?? (typeof req.query.s === 'string' ? req.query.s : '');
    if (presentedSecret && safeEqual(presentedSecret, legacySecret)) return SYSTEM_OWNER_ID;
  }
  return null;
};

// Persist a normalized result under `ownerId` and map outcome → HTTP. Shared by all 3 intakes.
const handleNormalized = async (
  res: Parameters<typeof ok>[0],
  result: NormalizeResult,
  ownerId: string,
): Promise<void> => {
  if (!result.ok) {
    if (result.status === 202) return void ok(res, { status: 'ignored', reason: result.error });
    return void fail(res, result.status, result.error);
  }
  const outcome = await captureLead(result.lead, ownerId);
  ok(res, { status: outcome.status, leadId: outcome.leadId ?? null });
};

// ---- POST /leads/webhook — generic JSON ----
leadsRouter.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const ownerId = await resolveIntakeOwner(req, env.MKT_LEAD_WEBHOOK_SECRET ?? null);
    if (!ownerId) return fail(res, 401, 'unauthorized');
    await handleNormalized(res, normalizeWebhook(asRecord(req.body)), ownerId);
  }),
);

// ---- POST /leads/form — Google-Form-style row ----
leadsRouter.post(
  '/form',
  asyncHandler(async (req, res) => {
    const ownerId = await resolveIntakeOwner(req, env.MKT_LEAD_WEBHOOK_SECRET ?? null);
    if (!ownerId) return fail(res, 401, 'unauthorized');
    await handleNormalized(res, normalizeForm(asRecord(req.body)), ownerId);
  }),
);

// ---- POST /leads/calcom — Cal.com webhook (query token/secret) ----
leadsRouter.post(
  '/calcom',
  asyncHandler(async (req, res) => {
    const ownerId = await resolveIntakeOwner(req, env.MKT_CALCOM_WEBHOOK_SECRET ?? null);
    if (!ownerId) return fail(res, 401, 'unauthorized');
    await handleNormalized(res, normalizeCalcom(asRecord(req.body)), ownerId);
  }),
);

// ---- Intake token management (JWT, owner-scoped) ----
const createTokenBody = z.object({ label: z.string().max(120).optional() });

leadsRouter.post(
  '/intake-tokens',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, createTokenBody, req.body ?? {});
    if (!body) return;
    const created = await createIntakeToken(req.userId!, body.label ?? null);
    logger.info('lead_intake_token_created', { ownerId: req.userId, id: created.id });
    // The plaintext token is returned ONCE — the UI must surface it immediately.
    res.status(201);
    ok(res, { id: created.id, token: created.token, label: created.label, createdAt: created.createdAt.toISOString() });
  }),
);

leadsRouter.get(
  '/intake-tokens',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await listIntakeTokens(req.userId!);
    ok(res, rows.map((t) => ({
      id: t.id, label: t.label, active: t.active,
      createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    })), { count: rows.length });
  }),
);

leadsRouter.delete(
  '/intake-tokens/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const okDel = await revokeIntakeToken(req.params.id, req.userId!);
    if (!okDel) return fail(res, 404, 'intake_token_not_found');
    res.status(204).end();
  }),
);

// ---- GET /leads — tenant-scoped read (JWT) ----
const toLeadDto = (l: DecryptedLead): Record<string, unknown> => ({
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
