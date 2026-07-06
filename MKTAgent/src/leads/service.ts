// Lead capture service — the chokepoint between intake routers and the DB. Owns
// per-owner dedupe, persistence, and best-effort notify.
//
// TENANCY (§01.1): the OWNER is resolved by the router from the presented intake token
// (per-owner) and passed in — so a captured lead lands on the right tenant, never a shared
// bucket. The legacy global webhook secret maps to SYSTEM_OWNER_ID (back-compat) at the router.
import { createLead, isDuplicateByEmail, isDuplicateByBookingUid } from '../db/repos/lead-repo.ts';
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
  // Dedupe: Cal.com by booking uid (survives webhook retries), else by email/30d.
  const dup =
    lead.source === 'calcom' && lead.calBookingUid
      ? await isDuplicateByBookingUid(ownerId, lead.calBookingUid)
      : await isDuplicateByEmail(ownerId, lead.email);

  if (dup) {
    logger.info('lead_duplicate', { ownerId, source: lead.source, email: lead.email });
    await logRun('info', 'mkt_lead', { status: 'duplicate', source: lead.source, email: lead.email }, ownerId);
    return { status: 'duplicate' };
  }

  // Rule-layer score on capture (deterministic, no token cost). LLM layer is user-triggered.
  const scored = ruleScore({ source: lead.source, hasPhone: Boolean(lead.phone), message: lead.message || null });
  const row = await createLead({
    ownerId,
    name: lead.name || null,
    email: lead.email,
    phone: lead.phone || null,
    message: lead.message || null,
    sourceProduct: lead.sourceProduct || null,
    source: lead.source,
    calBookingUid: lead.calBookingUid,
    score: scored.score,
    scoreReasons: scored.reasons,
  });

  await logRun('info', 'mkt_lead', { status: 'created', id: row.id, source: lead.source }, ownerId);
  logger.info('lead_created', { ownerId, leadId: row.id, source: lead.source });

  // Best-effort notify — must not affect the capture outcome.
  void notifySales(lead);

  return { status: 'created', leadId: row.id };
};
