// Auto-enroll sweep (Lead Nurture Agent Phase 01). Per-owner toggle-gated (User.nurtureEnabled,
// default OFF — noisy-auto-enroll risk) + idempotent (LeadNurtureThread.leadId is globally unique,
// so a lead already enrolled is silently skipped; a concurrent-enroll race is caught by
// nurture-thread-repo's P2002 guard). Owner-AGNOSTIC read (a trusted background sweep, like the
// leads/autonomy crons), then a per-thread write scoped by the row's own ownerId/leadId.
import { prisma } from '../db/client.ts';
import { listLeadsEligibleForNurture } from '../db/repos/lead-repo.ts';
import { enrollLead } from './nurture-thread-repo.ts';
import { buildSequence } from './sequence.ts';
import { logger } from '../lib/logger.ts';

export interface EnrollResult {
  ownersScanned: number;
  enrolled: number;
}

// One sweep across every owner with nurture ON. `now` is injectable for deterministic verification
// (sets each new thread's nextPlanAt so touch 0 is due). Bounded per-owner by the eligibility query.
export const enrollEligibleLeads = async (now: Date = new Date()): Promise<EnrollResult> => {
  const owners = await prisma.user.findMany({
    where: { nurtureEnabled: true },
    select: { id: true, nurtureMaxTouches: true, nurtureGapDays: true },
  });
  let enrolled = 0;
  for (const { id: ownerId, nurtureMaxTouches, nurtureGapDays } of owners) {
    // Snapshot this owner's CURRENT settings into the sequence id at enroll time (Phase 04) — a later
    // settings change never retroactively reshapes an already-running thread's cadence.
    const sequenceId = buildSequence(nurtureMaxTouches, nurtureGapDays).id;
    const leads = await listLeadsEligibleForNurture(ownerId);
    for (const lead of leads) {
      try {
        const thread = await enrollLead(ownerId, lead.id, sequenceId, now, lead.email);
        if (thread) enrolled++;
      } catch (e) {
        logger.warn('nurture_enroll_failed', { ownerId, leadId: lead.id, error: String(e).slice(0, 160) });
      }
    }
  }
  if (enrolled) logger.info('nurture_enrolled', { owners: owners.length, enrolled });
  return { ownersScanned: owners.length, enrolled };
};
