// Lead capture service — the chokepoint between intake routers and the DB. Owns
// per-owner dedupe, persistence, and best-effort notify.
//
// TENANCY (§01.1): the OWNER is resolved by the router from the presented intake token
// (per-owner) and passed in — so a captured lead lands on the right tenant, never a shared
// bucket. The legacy global webhook secret maps to SYSTEM_OWNER_ID (back-compat) at the router.
import { createLead, isDuplicateByEmail, isDuplicateByBookingUid, isDuplicateByPlatformUser } from '../db/repos/lead-repo.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { notifySales } from './notify.ts';
import { ruleScore } from './scoring/rule-score.ts';
import type { NormalizedLead } from './normalize.ts';

export interface CaptureOutcome {
  status: 'created' | 'duplicate';
  leadId?: string;
}

export const captureLead = async (lead: NormalizedLead, ownerId: string): Promise<CaptureOutcome> => {
  const email = lead.email && lead.email.trim() ? lead.email.trim().toLowerCase() : null;
  const hasPlatformIdentity = Boolean(lead.platform && lead.platformUserId);
  // The chokepoint invariant: every lead needs SOME stable identity to dedupe/target on. Normal
  // intake (webhook/form/calcom) always supplies an email (validated in normalize.ts); comment
  // sources (Phase 03) may supply platform+platformUserId INSTEAD when no email was typed — that's
  // the honest handle-only case. Neither present means the caller built a malformed lead — reject
  // here rather than mint an un-targetable, un-dedupeable row.
  if (!email && !hasPlatformIdentity) {
    throw new Error('captureLead: lead has neither an email nor a platform identity');
  }

  // Dedupe: Cal.com by booking uid (survives webhook retries); email/30d when typed; else
  // (handle-only comment lead) platform identity/30d — so the SAME commenter seen via BOTH the
  // Meta webhook and the 30-min poller lands on ONE lead, not two.
  const dup =
    lead.source === 'calcom' && lead.calBookingUid
      ? await isDuplicateByBookingUid(ownerId, lead.calBookingUid)
      : email
        ? await isDuplicateByEmail(ownerId, email)
        : await isDuplicateByPlatformUser(ownerId, lead.platform!, lead.platformUserId!);

  if (dup) {
    logger.info('lead_duplicate', { ownerId, source: lead.source, email, platformUserId: lead.platformUserId });
    await logRun('info', 'mkt_lead', { status: 'duplicate', source: lead.source, email }, ownerId);
    return { status: 'duplicate' };
  }

  // Rule-layer score on capture (deterministic, no token cost). LLM layer is user-triggered.
  const scored = ruleScore({ source: lead.source, hasPhone: Boolean(lead.phone), message: lead.message || null });
  const row = await createLead({
    ownerId,
    name: lead.name || null,
    email,
    phone: lead.phone || null,
    message: lead.message || null,
    sourceProduct: lead.sourceProduct || null,
    source: lead.source,
    calBookingUid: lead.calBookingUid,
    platform: lead.platform ?? null,
    platformUserId: lead.platformUserId ?? null,
    platformHandle: lead.platformHandle ?? null,
    score: scored.score,
    scoreReasons: scored.reasons,
  });

  await logRun('info', 'mkt_lead', { status: 'created', id: row.id, source: lead.source }, ownerId);
  logger.info('lead_created', { ownerId, leadId: row.id, source: lead.source, handleOnly: !email });

  // Best-effort notify — must not affect the capture outcome.
  void notifySales(lead);

  return { status: 'created', leadId: row.id };
};
