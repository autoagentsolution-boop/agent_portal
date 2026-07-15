// LeadNurtureThread + NurtureTouch persistence (Lead Nurture Agent Phase 01). `nextPlanAt` is the
// driver's atomic claim field — claimDueThread mirrors workflow-run-repo's claimScheduledDue
// (find-then-guarded-updateMany) so overlapping cron ticks never double-plan the same thread
// (HARD invariant: no double-touch). Every write here is scoped by the row's own id (a trusted
// background sweep, like the scheduler/autonomy repos) — callers that need tenant isolation
// (Phase 04 manual controls) additionally pass + guard on ownerId.
import { prisma } from '../db/client.ts';
import { cancelScheduled, transitionRun } from '../db/repos/workflow-run-repo.ts';
import type { LeadNurtureThread, NurtureTouch, NurtureStatus, NurtureMode } from '../../prisma/generated/prisma/client.ts';

export type { LeadNurtureThread, NurtureTouch, NurtureMode };

// Idempotent enroll: create an active/drip thread for a lead if none exists yet (leadId is globally
// unique on LeadNurtureThread). nextPlanAt=now → immediately claimable for touch 0 (the day-0 send).
// `now` is injectable for deterministic verification; production omits it (real wall clock).
// `leadEmail` is optional (Phase 01 callers omit it, unchanged behavior) — when given, an owner's
// ABSOLUTE opt-out suppression (Phase 03) blocks a fresh enroll even for a brand-new Lead row with the
// same address (HARD invariant: opt-out is global, never per-thread/per-lead-id only).
export const enrollLead = async (
  ownerId: string,
  leadId: string,
  sequenceId: string,
  now: Date = new Date(),
  leadEmail?: string,
): Promise<LeadNurtureThread | null> => {
  const existing = await prisma.leadNurtureThread.findUnique({ where: { leadId } });
  if (existing) return null; // already enrolled — idempotent no-op
  if (leadEmail && (await isEmailSuppressed(ownerId, leadEmail))) return null; // opted out — never re-enroll
  try {
    return await prisma.leadNurtureThread.create({
      data: { ownerId, leadId, sequenceId, status: 'active', mode: 'drip', nextPlanAt: now },
    });
  } catch (e) {
    // P2002 = unique violation on leadId — a concurrent enroll won the race. Idempotent no-op.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') return null;
    throw e;
  }
};

// Atomic claim of ONE due thread (mirrors claimScheduledDue): find a candidate, then a guarded
// updateMany scoped by id+status+nextPlanAt<=now that CLEARS nextPlanAt to null — the claim marker
// ("nothing due until the driver explicitly reschedules it"). Only one concurrent caller can win the
// race; the loser's updateMany affects 0 rows and this returns null.
export const claimDueThread = async (now: Date): Promise<LeadNurtureThread | null> => {
  const candidate = await prisma.leadNurtureThread.findFirst({
    where: { status: 'active', mode: 'drip', nextPlanAt: { lte: now } },
    orderBy: { nextPlanAt: 'asc' },
    select: { id: true },
  });
  if (!candidate) return null;
  const claim = await prisma.leadNurtureThread.updateMany({
    where: { id: candidate.id, status: 'active', mode: 'drip', nextPlanAt: { lte: now } },
    data: { nextPlanAt: null },
  });
  return claim.count === 1 ? prisma.leadNurtureThread.findUnique({ where: { id: candidate.id } }) : null;
};

// Requeue a thread after a planning failure so it retries later instead of sitting claimed (nextPlanAt
// null) forever. Best-effort backoff, not exact scheduling.
export const requeueThread = async (id: string, at: Date): Promise<void> => {
  await prisma.leadNurtureThread.update({ where: { id }, data: { nextPlanAt: at } });
};

export const getThreadById = (id: string): Promise<LeadNurtureThread | null> =>
  prisma.leadNurtureThread.findUnique({ where: { id } });

export const getThreadForOwner = (id: string, ownerId: string): Promise<LeadNurtureThread | null> =>
  prisma.leadNurtureThread.findFirst({ where: { id, ownerId } });

export const listThreadsForOwner = (ownerId: string): Promise<LeadNurtureThread[]> =>
  prisma.leadNurtureThread.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' } });

// Link a just-kicked-off run to its touch. Created ONLY after the run has already halted at an
// approval gate (nurture-runner.ts) — a touch row never represents an unsent/unreviewed send.
export const createTouch = (args: {
  threadId: string;
  ownerId: string;
  index: number;
  stage: string;
  runId: string;
  status: string;
  scheduledAt?: Date | null;
}): Promise<NurtureTouch> =>
  prisma.nurtureTouch.create({
    data: {
      threadId: args.threadId,
      ownerId: args.ownerId,
      index: args.index,
      stage: args.stage,
      runId: args.runId,
      status: args.status,
      scheduledAt: args.scheduledAt ?? null,
    },
  });

export const setTouchStatus = (
  id: string,
  status: string,
  data: { sentAt?: Date | null } = {},
): Promise<NurtureTouch> => prisma.nurtureTouch.update({ where: { id }, data: { status, ...data } });

// Advance the thread after a touch's outcome is known: bump touchNumber, (re)schedule the next plan
// (or mark completed when the sequence is exhausted), and persist Gmail thread/message ids — the
// send-completion hook Phase 02 will read (HARD invariant #5: leave the write path in place now).
export const advanceThread = (
  id: string,
  args: {
    touchNumber: number;
    nextPlanAt: Date | null;
    status?: NurtureStatus;
    gmailThreadId?: string | null;
    lastMessageId?: string | null;
  },
): Promise<LeadNurtureThread> =>
  prisma.leadNurtureThread.update({
    where: { id },
    data: {
      touchNumber: args.touchNumber,
      nextPlanAt: args.nextPlanAt,
      ...(args.status ? { status: args.status } : {}),
      ...(args.gmailThreadId !== undefined ? { gmailThreadId: args.gmailThreadId } : {}),
      ...(args.lastMessageId !== undefined ? { lastMessageId: args.lastMessageId } : {}),
    },
  });

// Touches whose run outcome the sweep hasn't reconciled yet — polled each tick to detect a completed
// send (or a failure) and advance the owning thread. This poll IS the "send-completion hook" (the
// executor itself carries no nurture awareness — agent-runners.ts/workflow-executor.ts are untouched).
export const pendingTouches = (limit = 100): Promise<NurtureTouch[]> =>
  prisma.nurtureTouch.findMany({
    where: { status: { in: ['awaiting_approval', 'scheduled'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

// Every touch on one thread (any status) — the nurture brain's conversation-history context (Phase 03),
// also the Nurture Inbox's timeline (Phase 04).
export const listTouchesForThread = (threadId: string): Promise<NurtureTouch[]> =>
  prisma.nurtureTouch.findMany({ where: { threadId }, orderBy: { index: 'asc' } });

// One touch, owner-scoped (Phase 04 approval inbox — approve/reject target a specific pending touch).
export const getTouchForOwner = (id: string, ownerId: string): Promise<NurtureTouch | null> =>
  prisma.nurtureTouch.findFirst({ where: { id, ownerId } });

// ── Manual controls (Phase 04 wires UI) — owner-scoped guarded transitions ─────────────────────────
export const pauseThread = async (id: string, ownerId: string): Promise<boolean> =>
  (
    await prisma.leadNurtureThread.updateMany({
      where: { id, ownerId, status: 'active' },
      data: { status: 'paused', nextPlanAt: null },
    })
  ).count === 1;

export const resumeThread = async (id: string, ownerId: string): Promise<boolean> =>
  (
    await prisma.leadNurtureThread.updateMany({
      where: { id, ownerId, status: 'paused' },
      data: { status: 'active', nextPlanAt: new Date() },
    })
  ).count === 1;

export const convertThread = async (id: string, ownerId: string): Promise<boolean> =>
  (
    await prisma.leadNurtureThread.updateMany({
      where: { id, ownerId, status: { in: ['active', 'paused'] } },
      data: { status: 'converted', nextPlanAt: null },
    })
  ).count === 1;

export const optOutThread = async (id: string, ownerId: string): Promise<boolean> =>
  (
    await prisma.leadNurtureThread.updateMany({
      where: { id, ownerId, status: { in: ['active', 'paused'] } },
      data: { status: 'opted_out', nextPlanAt: null },
    })
  ).count === 1;

// ── Reply poller (Phase 02) ─────────────────────────────────────────────────────────────────────────
// Threads with a real Gmail conversation to check for lead replies — ONLY threads WE started
// (gmailThreadId set on send) and still live. Never a general inbox scan (HARD invariant #2).
export const listThreadsWithGmail = (ownerId: string): Promise<LeadNurtureThread[]> =>
  prisma.leadNurtureThread.findMany({
    where: { ownerId, gmailThreadId: { not: null }, status: { in: ['active', 'paused'] } },
  });

// Distinct owners with at least one such thread — bounds the reply poller's per-tick owner sweep to
// tenants who could possibly have something to read (mirrors comment-poller's per-post scoping).
export const listOwnersWithGmailThreads = async (): Promise<string[]> => {
  const rows = await prisma.leadNurtureThread.findMany({
    where: { gmailThreadId: { not: null }, status: { in: ['active', 'paused'] } },
    distinct: ['ownerId'],
    select: { ownerId: true },
  });
  return rows.map((r) => r.ownerId);
};

// Stamp the poll checkpoint after a thread's Gmail messages were scanned. `hasReply` sets/clears
// hasUnhandledReply (Phase 03 consumes the flag); omit it to leave the flag untouched (a tick that
// ingested nothing new must not clear a still-unhandled reply from an earlier tick).
export const markThreadChecked = (id: string, checkedAt: Date, hasReply?: boolean): Promise<LeadNurtureThread> =>
  prisma.leadNurtureThread.update({
    where: { id },
    data: { lastCheckedAt: checkedAt, ...(hasReply !== undefined ? { hasUnhandledReply: hasReply } : {}) },
  });

// ── Nurture brain (Phase 03) ────────────────────────────────────────────────────────────────────────
// Atomic claim of ONE thread with an unhandled reply (mirrors claimDueThread): find a candidate, then a
// guarded updateMany scoped by id+hasUnhandledReply=true that FLIPS the flag false — the claim marker.
// Only one concurrent caller can win; a losing/overlapping tick's updateMany affects 0 rows → null.
export const claimReplyThread = async (): Promise<LeadNurtureThread | null> => {
  const candidate = await prisma.leadNurtureThread.findFirst({
    where: { hasUnhandledReply: true, status: { in: ['active', 'paused'] } },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
  });
  if (!candidate) return null;
  const claim = await prisma.leadNurtureThread.updateMany({
    where: { id: candidate.id, hasUnhandledReply: true },
    data: { hasUnhandledReply: false },
  });
  return claim.count === 1 ? prisma.leadNurtureThread.findUnique({ where: { id: candidate.id } }) : null;
};

// Re-flag a thread's reply as unhandled after a brain failure mid-processing, so the next tick retries
// instead of silently dropping a reply the claim already popped off the queue.
export const requeueReplyThread = async (id: string): Promise<void> => {
  await prisma.leadNurtureThread.update({ where: { id }, data: { hasUnhandledReply: true } });
};

export const setThreadMode = (id: string, mode: NurtureMode): Promise<LeadNurtureThread> =>
  prisma.leadNurtureThread.update({ where: { id }, data: { mode } });

export const setNeedsHuman = (id: string, needsHuman: boolean): Promise<LeadNurtureThread> =>
  prisma.leadNurtureThread.update({ where: { id }, data: { needsHuman } });

// Cancel every still-pending touch (awaiting a human's approval or parked at a future send time) on a
// thread — called when a reply changes the thread's course (pause/convert/opt-out, or a fresh
// conversational reply superseding the template cadence). Guarded transitions (transitionRun/
// cancelScheduled) no-op on a run that already moved on, so this is safe to call liberally. Returns the
// count actually cancelled.
export const cancelPendingTouches = async (threadId: string, ownerId: string): Promise<number> => {
  const touches = await prisma.nurtureTouch.findMany({
    where: { threadId, status: { in: ['awaiting_approval', 'scheduled'] } },
  });
  let cancelled = 0;
  for (const touch of touches) {
    if (!touch.runId) continue;
    const stopped = (await cancelScheduled(touch.runId, ownerId)) ?? (await transitionRun(touch.runId, ownerId, 'needs_approval', 'cancelled'));
    if (stopped) {
      await prisma.nurtureTouch.update({ where: { id: touch.id }, data: { status: 'skipped' } });
      cancelled++;
    }
  }
  return cancelled;
};

// Reject ONE pending touch (Phase 04 approval inbox): cancel its parked run and mark it skipped —
// the human declined THIS draft, but nothing was ever sent (fail-closed by construction: rejecting
// never has a send to undo). A drip-cadence touch (stage intro/value/cta) advances the thread past it
// so the sequence continues at the next touch, mirroring how a SENT touch advances touchNumber; a
// reply touch (stage 'reply', outside the 0..N cadence index space) just discards the draft — the
// thread stays in conversation mode, ready for the next real reply. Owner-scoped; false = not found /
// already resolved (e.g. a stale double-click after it was already approved/rejected).
export const rejectTouch = async (touchId: string, ownerId: string, now: Date = new Date()): Promise<boolean> => {
  const touch = await prisma.nurtureTouch.findFirst({
    where: { id: touchId, ownerId, status: { in: ['awaiting_approval', 'scheduled'] } },
  });
  if (!touch) return false;
  if (touch.runId) {
    const stopped = (await cancelScheduled(touch.runId, ownerId)) ?? (await transitionRun(touch.runId, ownerId, 'needs_approval', 'cancelled'));
    if (!stopped) return false; // the run moved on (e.g. concurrently approved) — don't skip a touch that may have sent
  }
  await prisma.nurtureTouch.update({ where: { id: touch.id }, data: { status: 'skipped' } });
  if (touch.stage !== 'reply') {
    await prisma.leadNurtureThread.update({
      where: { id: touch.threadId },
      data: { touchNumber: touch.index + 1, nextPlanAt: now },
    });
  }
  return true;
};

// ── Opt-out suppression (Phase 03) — ABSOLUTE + GLOBAL, keyed by email, checked at enroll (above) and
// pre-send (email_agent runner). Never per-thread: a re-captured lead with the same address must never
// be contacted again, even under a brand-new Lead row.
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const suppressEmail = async (ownerId: string, email: string, reason: string): Promise<void> => {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return;
  await prisma.nurtureSuppression.upsert({
    where: { uq_nurture_suppression_owner_email: { ownerId, emailLower } },
    create: { ownerId, emailLower, reason },
    update: {}, // already suppressed — idempotent, keep the original reason/timestamp
  });
};

export const isEmailSuppressed = async (ownerId: string, email: string): Promise<boolean> => {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return false;
  const row = await prisma.nurtureSuppression.findUnique({
    where: { uq_nurture_suppression_owner_email: { ownerId, emailLower } },
  });
  return row !== null;
};
