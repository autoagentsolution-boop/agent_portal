// DTO assembly for the Nurture Inbox router (Lead Nurture Agent Phase 04). Split out of
// nurture-router.ts to keep the route handlers focused — this file only shapes read models, no writes.
import { ok, fail } from './http.ts';
import { getRunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { agentGate } from '../orchestration/registry/agent-registry.ts';
import { getLead } from '../db/repos/lead-repo.ts';
import { listTouchesForThread, getThreadForOwner, setNeedsHuman, type LeadNurtureThread, type NurtureTouch } from '../nurture/nurture-thread-repo.ts';
import { listRepliesForThread, type DecryptedReply } from '../nurture/reply-repo.ts';

const toTouchDto = (t: NurtureTouch) => ({
  id: t.id,
  index: t.index,
  stage: t.stage,
  status: t.status,
  scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
  sentAt: t.sentAt ? t.sentAt.toISOString() : null,
  runId: t.runId,
});

const toReplyDto = (r: DecryptedReply) => ({
  id: r.id,
  fromEmail: r.fromEmail,
  body: r.body,
  receivedAt: r.receivedAt.toISOString(),
  handled: r.handled,
});

interface PendingDraft {
  touchId: string;
  runId: string;
  gate: 'schedule' | 'send' | null;
  to: string[] | null;
  subject: string | null;
  body: string | null;
}

// The draft + which gate is currently halting a pending touch's run — null fields when the run has no
// email_draft yet (shouldn't happen for a parked touch, but never let a read path throw on it).
const pendingDraftFor = async (touch: NurtureTouch, ownerId: string): Promise<PendingDraft | null> => {
  if (!touch.runId) return null;
  const run = await getRunWithNodes(touch.runId, ownerId);
  if (!run) return null;
  const draftArtifact = run.artifacts.find((a) => a.type === 'email_draft');
  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  const draft = draftArtifact?.data as { to?: string[]; subject?: string; body?: string } | undefined;
  return {
    touchId: touch.id,
    runId: touch.runId,
    gate: gateNode ? (agentGate(gateNode.agentId) === 'schedule' ? 'schedule' : 'send') : null,
    to: draft?.to ?? null,
    subject: draft?.subject ?? null,
    body: draft?.body ?? null,
  };
};

export const threadDetailDto = async (thread: LeadNurtureThread, ownerId: string) => {
  const [lead, touches, replies] = await Promise.all([
    getLead(thread.leadId, ownerId),
    listTouchesForThread(thread.id),
    listRepliesForThread(thread.id),
  ]);
  const pending = touches.filter((t) => t.status === 'awaiting_approval' || t.status === 'scheduled');
  const pendingDrafts = (await Promise.all(pending.map((t) => pendingDraftFor(t, ownerId))))
    .filter((d): d is PendingDraft => d !== null);
  return {
    id: thread.id,
    leadId: thread.leadId,
    leadName: lead?.name ?? null,
    leadEmail: lead?.email ?? null,
    status: thread.status,
    mode: thread.mode,
    touchNumber: thread.touchNumber,
    nextPlanAt: thread.nextPlanAt ? thread.nextPlanAt.toISOString() : null,
    hasUnhandledReply: thread.hasUnhandledReply,
    needsHuman: thread.needsHuman,
    gmailThreadId: thread.gmailThreadId,
    updatedAt: thread.updatedAt.toISOString(),
    touches: touches.map(toTouchDto),
    replies: replies.map(toReplyDto),
    pendingDrafts,
  };
};

export const toThreadListDto = async (t: LeadNurtureThread, ownerId: string) => {
  const lead = await getLead(t.leadId, ownerId);
  return {
    id: t.id,
    leadId: t.leadId,
    leadName: lead?.name ?? null,
    leadEmail: lead?.email ?? null,
    status: t.status,
    mode: t.mode,
    touchNumber: t.touchNumber,
    nextPlanAt: t.nextPlanAt ? t.nextPlanAt.toISOString() : null,
    hasUnhandledReply: t.hasUnhandledReply,
    needsHuman: t.needsHuman,
    updatedAt: t.updatedAt.toISOString(),
  };
};

// Re-fetch + clear needsHuman (best-effort) after any inbox action resolves a thread — Phase 03 flags
// needsHuman on escalation and explicitly deferred clearing it to "the Phase 04 approval-inbox action
// that resolves it" (nurture-thread-repo.ts comment).
export const respondThread = async (res: Parameters<typeof ok>[0], threadId: string, ownerId: string, wasNeedsHuman: boolean): Promise<void> => {
  if (wasNeedsHuman) await setNeedsHuman(threadId, false).catch(() => {});
  const fresh = await getThreadForOwner(threadId, ownerId);
  if (!fresh) return fail(res as never, 404, 'thread_not_found');
  ok(res, await threadDetailDto(fresh, ownerId));
};
