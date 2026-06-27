// Lead capture service — the chokepoint between intake routers and the DB. Owns
// tenant resolution, per-owner dedupe, persistence, and best-effort notify.
//
// TENANCY (v1): inbound funnels (form services, Cal.com) can only present a shared
// secret — they have no JWT. So a captured lead is attributed to the SYSTEM/DAIS
// owner. `resolveLeadOwner()` is the single seam to extend later (per-owner intake
// tokens / funnel→owner map) without touching the routers — same external-onboarding
// gate as the social connect-flow.
import { createLead, isDuplicateByEmail, isDuplicateByBookingUid } from '../db/repos/lead-repo.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { notifySales } from './notify.ts';
import type { NormalizedLead } from './normalize.ts';

// v1: every funnel lead → system owner. Hook point for per-owner intake later.
export const resolveLeadOwner = (): string => SYSTEM_OWNER_ID;

export interface CaptureOutcome {
  status: 'created' | 'duplicate';
  leadId?: string;
}

export const captureLead = async (lead: NormalizedLead): Promise<CaptureOutcome> => {
  const ownerId = resolveLeadOwner();

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

  const row = await createLead({
    ownerId,
    name: lead.name || null,
    email: lead.email,
    phone: lead.phone || null,
    message: lead.message || null,
    sourceProduct: lead.sourceProduct || null,
    source: lead.source,
    calBookingUid: lead.calBookingUid,
    rawPayload: lead.rawPayload as object,
  });

  await logRun('info', 'mkt_lead', { status: 'created', id: row.id, source: lead.source }, ownerId);
  logger.info('lead_created', { ownerId, leadId: row.id, source: lead.source });

  // Best-effort notify — must not affect the capture outcome.
  void notifySales(lead);

  return { status: 'created', leadId: row.id };
};
