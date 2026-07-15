// Email router (Atria v2 P2-2c). The Email Agent's surface: list nurture-worthy leads, draft a
// personalised email (LLM), and send it from the owner's own Gmail (human gate — one lead per
// explicit send, no blast). Tenant-scoped via requireAuth. Send stamps lead.nurturedAt (idempotency
// + audit + UI badge). Reuses the Lead repo (decrypt) + gmail-send + email-agent.
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { listLeads, getLead, markLeadNurtured } from '../db/repos/lead-repo.ts';
import { getUserById } from '../db/repos/user-repo.ts';
import { draftNurtureEmail } from '../email/email-agent.ts';
import { sendGmailAs, hasGmailConnected } from '../email/gmail-send.ts';
import { isEmailSuppressed } from '../nurture/nurture-thread-repo.ts';
import { logRun } from '../db/client.ts';

export const emailRouter: Router = Router();

// Is the owner's Google connect present (Gmail piggybacks the Drive token). Scope sufficiency is only
// provable at send time — an old drive-only token surfaces gmail_scope_missing then.
emailRouter.get('/status', asyncHandler(async (req, res) => {
  ok(res, { connected: await hasGmailConnected(req.userId!) });
}));

// Leads that can be nurtured: have an email address. Highest intent + never-contacted first, so the
// user works the best leads. Returns the fields the panel needs (no message body — kept lean).
emailRouter.get('/leads', asyncHandler(async (req, res) => {
  const leads = await listLeads({ ownerId: req.userId!, limit: 100 });
  const rows = leads
    .filter((l) => l.email)
    .sort((a, b) => Number(Boolean(a.nurturedAt)) - Number(Boolean(b.nurturedAt)) || (b.score ?? 0) - (a.score ?? 0))
    .map((l) => ({
      id: l.id, name: l.name, email: l.email, sourceProduct: l.sourceProduct,
      score: l.score, nurturedAt: l.nurturedAt ? l.nurturedAt.toISOString() : null,
    }));
  ok(res, rows, { count: rows.length });
}));

// Draft a nurture email for one lead (LLM; nothing sent). Grounded in the lead + the owner's brand.
emailRouter.post('/draft', asyncHandler(async (req, res) => {
  const body = parseOr422(res, z.object({ leadId: z.string().uuid() }).strict(), req.body ?? {});
  if (!body) return;
  const lead = await getLead(body.leadId, req.userId!);
  if (!lead) return fail(res, 404, 'lead_not_found');
  const user = await getUserById(req.userId!);
  const draft = await draftNurtureEmail(req.userId!, lead, { brand: user?.brandName ?? null });
  ok(res, { leadId: lead.id, to: lead.email, ...draft });
}));

// Send the (user-reviewed) email to one lead from the owner's Gmail, then stamp nurturedAt. The
// address comes from the LEAD record (not the body) so a client can't retarget an arbitrary recipient.
const sendBody = z.object({
  leadId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
}).strict();

emailRouter.post('/send', asyncHandler(async (req, res) => {
  const body = parseOr422(res, sendBody, req.body ?? {});
  if (!body) return;
  const lead = await getLead(body.leadId, req.userId!);
  if (!lead) return fail(res, 404, 'lead_not_found');
  if (!lead.email) return fail(res, 409, 'lead_has_no_email');
  // Opt-out is ABSOLUTE + GLOBAL (Phase 03) — this panel sends directly via Gmail, bypassing the
  // orchestration executor's own pre-send gate, so it needs its own suppression check.
  if (await isEmailSuppressed(req.userId!, lead.email)) return fail(res, 409, 'lead_opted_out');

  const result = await sendGmailAs(req.userId!, { to: lead.email, subject: body.subject, body: body.body });
  if (!result.ok) {
    return fail(res, result.error === 'gmail_scope_missing' ? 409 : 502, result.error ?? 'send_failed');
  }
  await markLeadNurtured(lead.id, req.userId!);
  await logRun('info', 'email_nurture_sent', { leadId: lead.id, messageId: result.id ?? null }, req.userId!);
  ok(res, { leadId: lead.id, sent: true, messageId: result.id ?? null });
}));
