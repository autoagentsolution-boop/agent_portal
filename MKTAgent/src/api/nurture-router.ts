// Nurture Inbox router (Lead Nurture Agent Phase 04). ONE place a human works the pipeline: every
// proactive touch (Phase 01) and every reply draft (Phase 03) lands here as a pending item on its
// thread's timeline, approved/edited/rejected before it can ever send.
//
// Approve does NOT proxy through orchestration-router's HTTP `/approve-node` endpoint — it calls
// `runWorkflow` directly with `approveNodeId`, exactly like verify-nurture-drip.ts's approveNode()
// helper (whose own comment says it "mirrors what the real /approve-node route + Phase 04's future
// approval inbox do"). Reusing the schedule-gate's special park-for-a-future-cron path would reject a
// nurture touch's schedule instant (it's "now", set at plan time — not a real future user-facing pick),
// so nurture keeps its own thin resume call instead: for a touch with a spliced scheduler node the human
// clears TWO gates in the SAME thread (schedule confirm, then send) with two Approve clicks; for touch 0
// / a reply draft there's only one gate. Either way every send still has an explicit approval record
// (HARD invariant #1) — this file is the ONLY caller that waives a nurture run's gate.
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { threadDetailDto, toThreadListDto, respondThread } from './nurture-mappers.ts';
import { logger } from '../lib/logger.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { runWorkflow } from '../orchestration/executor/workflow-executor.ts';
import { getRunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { updateArtifactData } from '../orchestration/executor/artifact-store.ts';
import { getLead } from '../db/repos/lead-repo.ts';
import { getUserById, setNurtureSettings } from '../db/repos/user-repo.ts';
import { getSequence } from '../nurture/sequence.ts';
import { preSendCheck } from '../nurture/guardrails.ts';
import { advanceOneTouch } from '../nurture/nurture-runner.ts';
import {
  getThreadForOwner,
  listThreadsForOwner,
  getTouchForOwner,
  pauseThread,
  resumeThread,
  convertThread,
  optOutThread,
  rejectTouch,
  cancelPendingTouches,
  suppressEmail,
} from '../nurture/nurture-thread-repo.ts';

export const nurtureRouter: Router = Router();

// ── Threads list + detail ───────────────────────────────────────────────────────────────────────────
nurtureRouter.get('/threads', asyncHandler(async (req, res) => {
  const threads = await listThreadsForOwner(req.userId!);
  const rows = await Promise.all(threads.map((t) => toThreadListDto(t, req.userId!)));
  ok(res, rows, { count: rows.length });
}));

nurtureRouter.get('/threads/:id', asyncHandler(async (req, res) => {
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  ok(res, await threadDetailDto(thread, req.userId!));
}));

// ── Approve (+ optional edit) ───────────────────────────────────────────────────────────────────────
const approveBody = z.object({
  touchId: z.string().uuid(),
  editedSubject: z.string().max(200).optional(),
  editedBody: z.string().max(8000).optional(),
}).strict();

nurtureRouter.post('/threads/:id/approve', asyncHandler(async (req, res) => {
  const body = parseOr422(res, approveBody, req.body ?? {});
  if (!body) return;
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  const touch = await getTouchForOwner(body.touchId, req.userId!);
  if (!touch || touch.threadId !== thread.id) return fail(res, 404, 'touch_not_found');
  if (touch.status !== 'awaiting_approval' && touch.status !== 'scheduled') return fail(res, 409, 'touch_not_pending');
  if (!touch.runId) return fail(res, 409, 'touch_has_no_run');

  const run = await getRunWithNodes(touch.runId, req.userId!);
  if (!run) return fail(res, 404, 'run_not_found');
  if (run.status !== 'needs_approval') return fail(res, 409, 'run_not_awaiting_approval');
  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  if (!gateNode) return fail(res, 409, 'no_gate_node');

  // Edit-before-approve (HARD invariant #2: recipient is NEVER editable here — `to` is left exactly as
  // email_writer built it from the Lead record; only subject/body can be overwritten).
  if (body.editedSubject?.trim() || body.editedBody?.trim()) {
    const draftArtifact = run.artifacts.find((a) => a.type === 'email_draft');
    if (!draftArtifact) return fail(res, 409, 'no_draft_to_edit');
    const current = draftArtifact.data as { to: string[]; subject: string; body: string; groundedOn: string | null };
    const nextSubject = body.editedSubject?.trim() ? body.editedSubject.trim().slice(0, 200) : current.subject;
    const nextBody = body.editedBody?.trim() ? body.editedBody.trim().slice(0, 8000) : current.body;
    if (!nextBody.trim()) return fail(res, 422, 'empty_body');
    await updateArtifactData(draftArtifact.id, req.userId!, 'email_draft', { ...current, subject: nextSubject, body: nextBody });
  }

  // Pre-send guardrail — fail-closed, checked at EVERY gate (not only the send gate) so an opt-out or a
  // cap breach blocks a schedule-gate approval too, before the run ever reaches the send gate.
  const lead = await getLead(thread.leadId, req.userId!);
  if (!lead) return fail(res, 404, 'lead_not_found');
  const maxTouches = getSequence(thread.sequenceId).touches.length;
  const guard = await preSendCheck(req.userId!, lead.email, touch.index, maxTouches);
  if (!guard.ok) return fail(res, 409, guard.reason ?? 'guardrail_blocked');

  const goal = goalSpec.parse(run.goal);
  const plan = workflowPlan.parse(run.plan);
  const outcome = await runWorkflow(run.id, req.userId!, goal, plan, { approveNodeId: gateNode.nodeId });

  // Reconcile the touch/thread against the run's new state immediately (don't wait on the next cron
  // tick) — safe to call redundantly with the sweep (see advanceOneTouch's own comment).
  const freshTouch = (await getTouchForOwner(touch.id, req.userId!)) ?? touch;
  await advanceOneTouch(freshTouch, new Date()).catch((e) => {
    logger.warn('nurture_approve_reconcile_failed', { touchId: touch.id, error: String(e).slice(0, 160) });
  });

  logger.info('nurture_touch_approved', { threadId: thread.id, touchId: touch.id, runId: run.id, gate: gateNode.agentId, outcome: outcome.status });
  await respondThread(res, thread.id, req.userId!, thread.needsHuman);
}));

// ── Reject ───────────────────────────────────────────────────────────────────────────────────────────
const touchIdBody = z.object({ touchId: z.string().uuid() }).strict();

nurtureRouter.post('/threads/:id/reject', asyncHandler(async (req, res) => {
  const body = parseOr422(res, touchIdBody, req.body ?? {});
  if (!body) return;
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  const touch = await getTouchForOwner(body.touchId, req.userId!);
  if (!touch || touch.threadId !== thread.id) return fail(res, 404, 'touch_not_found');
  const rejected = await rejectTouch(touch.id, req.userId!);
  if (!rejected) return fail(res, 409, 'touch_not_pending');
  logger.info('nurture_touch_rejected', { threadId: thread.id, touchId: touch.id });
  await respondThread(res, thread.id, req.userId!, thread.needsHuman);
}));

// ── Manual controls (pause / resume / convert / opt-out) ───────────────────────────────────────────────
// Every control cancels any still-pending touch first — a paused/converted/opted-out thread must never
// let a stray already-parked draft slip through on a later separate approval.
nurtureRouter.post('/threads/:id/pause', asyncHandler(async (req, res) => {
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  await cancelPendingTouches(thread.id, req.userId!).catch(() => {});
  if (!(await pauseThread(thread.id, req.userId!))) return fail(res, 409, 'thread_not_pausable');
  logger.info('nurture_thread_paused', { threadId: thread.id });
  await respondThread(res, thread.id, req.userId!, thread.needsHuman);
}));

nurtureRouter.post('/threads/:id/resume', asyncHandler(async (req, res) => {
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  if (!(await resumeThread(thread.id, req.userId!))) return fail(res, 409, 'thread_not_resumable');
  logger.info('nurture_thread_resumed', { threadId: thread.id });
  await respondThread(res, thread.id, req.userId!, thread.needsHuman);
}));

nurtureRouter.post('/threads/:id/convert', asyncHandler(async (req, res) => {
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  await cancelPendingTouches(thread.id, req.userId!).catch(() => {});
  if (!(await convertThread(thread.id, req.userId!))) return fail(res, 409, 'thread_not_convertible');
  logger.info('nurture_thread_converted', { threadId: thread.id });
  await respondThread(res, thread.id, req.userId!, thread.needsHuman);
}));

nurtureRouter.post('/threads/:id/opt-out', asyncHandler(async (req, res) => {
  const thread = await getThreadForOwner(req.params.id, req.userId!);
  if (!thread) return fail(res, 404, 'thread_not_found');
  const lead = await getLead(thread.leadId, req.userId!);
  await cancelPendingTouches(thread.id, req.userId!).catch(() => {});
  if (!(await optOutThread(thread.id, req.userId!))) return fail(res, 409, 'thread_not_optoutable');
  // Absolute + global suppression (Phase 03 invariant) — outlives this thread/lead row.
  if (lead?.email) await suppressEmail(req.userId!, lead.email, 'inbox: manual opt-out').catch(() => {});
  logger.info('nurture_thread_opted_out', { threadId: thread.id });
  await respondThread(res, thread.id, req.userId!, thread.needsHuman);
}));

// ── Owner settings ───────────────────────────────────────────────────────────────────────────────────
nurtureRouter.get('/settings', asyncHandler(async (req, res) => {
  const user = await getUserById(req.userId!);
  if (!user) return fail(res, 404, 'user_not_found');
  ok(res, { enabled: user.nurtureEnabled, maxTouches: user.nurtureMaxTouches, gapDays: user.nurtureGapDays });
}));

const settingsBody = z.object({
  enabled: z.boolean().optional(),
  maxTouches: z.number().int().min(1).max(12).optional(),
  gapDays: z.number().int().min(1).max(30).optional(),
}).strict();

nurtureRouter.put('/settings', asyncHandler(async (req, res) => {
  const body = parseOr422(res, settingsBody, req.body ?? {});
  if (!body) return;
  const user = await setNurtureSettings(req.userId!, body);
  logger.info('nurture_settings_updated', { ownerId: req.userId, ...body });
  ok(res, { enabled: user.nurtureEnabled, maxTouches: user.nurtureMaxTouches, gapDays: user.nurtureGapDays });
}));
