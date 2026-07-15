// Nurture compliance/guardrail layer (Lead Nurture Agent Phase 04). Two jobs:
//   1. Unsubscribe signed-link — mirrors api/autonomy-grant-token.ts's stateless-HMAC pattern (no DB
//      row, survives restarts): a link a lead clicks needs no session, so it carries its own proof
//      (ownerId+email can't be forged without the server secret).
//   2. Pre-send check — the LAST checkpoint before a nurture email actually leaves, called from
//      nurture-router's approve handler right before it waives the email_agent gate. Fail-CLOSED:
//      anything that can't be positively confirmed blocks the send rather than letting it through
//      (HARD invariant #4: guardrails block over-max-touches / opted-out / daily-cap-exceeded sends).
//
// enroll-time checks (opt-out suppression, the nurtureEnabled toggle, has-email) already live inline
// in enroll.ts / nurture-thread-repo.ts.enrollLead / lead-repo.ts.listLeadsEligibleForNurture — this
// module doesn't duplicate that control flow, but `canEnroll` below aggregates the same rules into one
// assertable function so the e2e verify (and any future caller) has a single source of truth to check
// against instead of re-deriving them from three files.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.ts';
import { prisma } from '../db/client.ts';
import { isEmailSuppressed } from './nurture-thread-repo.ts';

// Generous per-owner ceiling — guards against a runaway loop (a bug re-planning the same thread every
// tick), not normal single-tenant usage. Not exposed as a setting (YAGNI); revisit if it ever bites.
const DAILY_SEND_CAP = 100;

const key = (): string => env.JWT_SECRET || 'atria-nurture-unsub-dev-secret';

// Token = HMAC(ownerId + lowercased email). Deterministic + stateless: no DB row, so a link minted
// today still verifies after a redeploy/restart. Scoped to (ownerId, email) — a token for one lead
// can't unsubscribe another, and can't cross tenants.
export const issueUnsubscribeToken = (ownerId: string, emailLower: string): string =>
  createHmac('sha256', key()).update(`nurture-unsub:${ownerId}:${emailLower}`).digest('hex');

export const verifyUnsubscribeToken = (ownerId: string, emailLower: string, token: unknown): boolean => {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = issueUnsubscribeToken(ownerId, emailLower);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// The absolute link a nurture email's footer + List-Unsubscribe header point to (gmail-send.ts calls
// this per-recipient). PUBLIC_BASE_URL is the same var connect-router.ts already uses for absolute
// callback URLs, so no new env plumbing.
export const buildUnsubscribeUrl = (ownerId: string, email: string): string => {
  const emailLower = email.trim().toLowerCase();
  const token = issueUnsubscribeToken(ownerId, emailLower);
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const qs = new URLSearchParams({ owner: ownerId, email: emailLower, token }).toString();
  return `${base}/leads/unsubscribe?${qs}`;
};

export interface GuardrailResult { ok: boolean; reason?: string }

// Reply touches (nurture-runner.ts) are indexed 100+n, deliberately outside the drip cadence's 0..N
// index space — a conversational reply is never subject to the drip's max-touches cap.
const isReplyTouchIndex = (index: number): boolean => index >= 100;

// Pre-send check — called right before nurture-router waives the email_agent gate for one touch.
export const preSendCheck = async (
  ownerId: string,
  email: string,
  touchIndex: number,
  maxTouches: number,
): Promise<GuardrailResult> => {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, reason: 'no_recipient' }; // can't build an unsubscribe link either
  if (await isEmailSuppressed(ownerId, trimmed)) return { ok: false, reason: 'lead_opted_out' };
  if (!isReplyTouchIndex(touchIndex) && touchIndex >= maxTouches) return { ok: false, reason: 'max_touches_reached' };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentToday = await prisma.nurtureTouch.count({ where: { ownerId, status: 'sent', sentAt: { gte: since } } });
  if (sentToday >= DAILY_SEND_CAP) return { ok: false, reason: 'daily_send_cap_reached' };
  return { ok: true };
};

// Enroll-check aggregator (see file header) — not wired into the enroll sweep's own control flow
// (that logic already exists and is left untouched to avoid regressing Phase 01-03), but callable
// standalone so the guardrail RULES themselves are asserted in one place.
export const canEnroll = async (ownerId: string, email: string, nurtureEnabled: boolean): Promise<GuardrailResult> => {
  if (!nurtureEnabled) return { ok: false, reason: 'nurture_disabled' };
  if (!email.trim()) return { ok: false, reason: 'no_email' };
  if (await isEmailSuppressed(ownerId, email)) return { ok: false, reason: 'opted_out' };
  return { ok: true };
};
