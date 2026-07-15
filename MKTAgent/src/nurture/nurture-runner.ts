// nurture-runner.ts — Lead Nurture Agent driver sweep (Phase 01). Mirrors autonomy-runner.ts's
// pattern (atomic-claim a due unit of work, act, advance state) but drives EMAIL touches instead of
// granted runs. Every touch is ONE run through the EXISTING, validated send path (email_writer →
// [scheduler] → email_agent) — this file only PLANS and KICKS OFF that run; it never sends anything
// itself. The executor's approval gate (requiresApproval=true on email_agent/scheduler, untouched
// here) is what actually stops an unattended send — HARD invariant #1.
//
// Each sweep does three things, in order:
//   1. enroll   — sweep eligible leads into fresh threads (enroll.ts)
//   2. advance  — poll touches parked on a prior tick; a run that reached `completed` sent for real,
//                 so bump the thread's touchNumber/nextPlanAt (or complete it). This poll IS the
//                 "send-completion hook" — agent-runners.ts/workflow-executor.ts stay untouched.
//   3. plan     — atomically claim up to maxPerTick due threads and kick off their next touch
import { getLead } from '../db/repos/lead-repo.ts';
import { getUserById } from '../db/repos/user-repo.ts';
import { listProductKnowledge } from '../db/repos/product-knowledge-repo.ts';
import { createRun, createNodes, getRunForOwner } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from '../orchestration/executor/workflow-executor.ts';
import { planWorkflow } from '../orchestration/master/workflow-planner.ts';
import { goalSpec, type GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import { listArtifacts } from '../orchestration/executor/artifact-store.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { env } from '../config/env.ts';
import { enrollEligibleLeads } from './enroll.ts';
import { runNurtureBrain, type RawGeminiCallFn } from './nurture-brain.ts';
import type { NurtureDraft } from './decision-schema.ts';
import { listUnhandledReplies, markReplyHandled } from './reply-repo.ts';
import {
  claimDueThread,
  requeueThread,
  createTouch,
  setTouchStatus,
  advanceThread,
  pendingTouches,
  getThreadById,
  claimReplyThread,
  requeueReplyThread,
  setThreadMode,
  setNeedsHuman,
  cancelPendingTouches,
  listTouchesForThread,
  pauseThread,
  convertThread,
  optOutThread,
  suppressEmail,
  type LeadNurtureThread,
  type NurtureTouch,
} from './nurture-thread-repo.ts';
import { getSequence, nextTouch, gapDaysAfter, STAGE_INTENT } from './sequence.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Build the nurture GoalSpec for one touch. Recipient ALWAYS comes from the Lead RECORD (never
// client input — HARD invariant #4). Touch 0 sends immediately (no schedule); touch>=1 carries a
// confirmed schedule so the planner splices the `scheduler` node before email_agent.
const buildTouchGoal = (
  thread: LeadNurtureThread,
  lead: { id: string; email: string },
  stage: string,
  scheduleAt: Date | null,
): GoalSpec =>
  goalSpec.parse({
    outputs: { needsEmail: true, needsPublishing: false, needsTextPost: false },
    slots: {
      emailTo: lead.email,
      leadId: lead.id,
      angle: STAGE_INTENT[stage] ?? stage,
      nurtureThreadId: thread.id,
      nurtureStage: stage,
    },
    schedule: scheduleAt
      ? { at: scheduleAt.toISOString(), phrase: 'nurture cadence', timezone: 'UTC', confirmed: true }
      : undefined,
    provider: 'nurture-runner',
  });

// Build the reply GoalSpec (Phase 03). The draft is already grounded + guardrailed by the nurture
// brain, so it's carried VERBATIM via the nurtureReplySubject/Body seed slots (email_writer skips its
// own LLM call when they're set) — threading (Gmail threadId/In-Reply-To/References) is picked up
// automatically by email_agent from nurtureThreadId, same as every other touch. Always immediate (no
// schedule) — a reply reply is sent as soon as a human approves it, never deferred.
const buildReplyGoal = (thread: LeadNurtureThread, lead: { id: string; email: string }, draft: NurtureDraft): GoalSpec =>
  goalSpec.parse({
    outputs: { needsEmail: true, needsPublishing: false, needsTextPost: false },
    slots: {
      emailTo: lead.email,
      leadId: lead.id,
      nurtureThreadId: thread.id,
      nurtureStage: 'reply',
      nurtureReplySubject: draft.subject,
      nurtureReplyBody: draft.body,
    },
    provider: 'nurture-brain',
  });

// Process ONE thread's unhandled reply/replies (Phase 03 conversation branch) — always runs BEFORE any
// proactive drip planning for a thread the driver claims this way. A reply ALWAYS interrupts the drip
// (mode → conversation, any still-pending touch cancelled) regardless of what the brain ultimately
// decides — "a reply cancels pending drip touches" is unconditional, not just on draft_reply. The brain
// itself never sends: draft_reply only creates an approval-parked run, exactly like a proactive touch.
const processReplyThread = async (thread: LeadNurtureThread, now: Date, opts: ExecuteOptions, brainCallFn?: RawGeminiCallFn): Promise<void> => {
  const unhandled = await listUnhandledReplies(thread.id);
  if (!unhandled.length) return; // claimed but nothing left to process (race with an earlier tick) — no-op

  const lead = await getLead(thread.leadId, thread.ownerId);
  if (!lead || !lead.email.trim()) {
    await setNeedsHuman(thread.id, true);
    for (const r of unhandled) await markReplyHandled(r.id);
    logger.warn('nurture_reply_lead_unusable', { threadId: thread.id, leadId: thread.leadId });
    return;
  }

  await setThreadMode(thread.id, 'conversation');
  await cancelPendingTouches(thread.id, thread.ownerId);

  const [owner, knowledge, touches] = await Promise.all([
    getUserById(thread.ownerId),
    listProductKnowledge(thread.ownerId),
    listTouchesForThread(thread.id),
  ]);
  const latest = unhandled[unhandled.length - 1]!;
  const decision = await runNurtureBrain(
    {
      ownerId: thread.ownerId,
      lead: { name: lead.name, sourceProduct: lead.sourceProduct, message: lead.message },
      brand: owner?.brandName ?? null,
      productKnowledge: knowledge.length ? knowledge.map((k) => k.productDetails).join('\n\n').slice(0, 3000) : null,
      touches: touches.map((t) => ({ index: t.index, stage: t.stage, status: t.status })),
      priorReplies: unhandled.slice(0, -1).map((r) => ({ body: r.body, receivedAt: r.receivedAt })),
      latestReply: { body: latest.body, receivedAt: latest.receivedAt },
    },
    brainCallFn,
  );

  switch (decision.action) {
    case 'draft_reply': {
      if (!decision.draft) { await setNeedsHuman(thread.id, true); break; } // defensive — schema forbids this
      const goal = buildReplyGoal(thread, lead, decision.draft);
      const plan = planWorkflow(goal);
      if (!plan.ok) throw new Error(`nurture_reply_plan_failed: ${plan.error}`);
      const run = await createRun({ ownerId: thread.ownerId, goal, plan: plan.plan, status: 'planned' });
      await createNodes(run.id, thread.ownerId, plan.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
      const outcome = await runWorkflow(run.id, thread.ownerId, goal, plan.plan, opts);
      if (outcome.status !== 'needs_approval') throw new Error(`nurture_reply_did_not_park: run=${run.id} status=${outcome.status}`);
      // Reply touches live outside the 0/1/2 sequence index space so they never collide with a template
      // touch's index — purely a display/audit distinction, no uniqueness constraint depends on it.
      const replyIndex = 100 + touches.filter((t) => t.stage === 'reply').length;
      await createTouch({ threadId: thread.id, ownerId: thread.ownerId, index: replyIndex, stage: 'reply', runId: run.id, status: 'awaiting_approval', scheduledAt: null });
      break;
    }
    case 'pause':
      await pauseThread(thread.id, thread.ownerId);
      break;
    case 'mark_converted':
      await convertThread(thread.id, thread.ownerId);
      break;
    case 'mark_opted_out':
      await optOutThread(thread.id, thread.ownerId);
      // Absolute + global suppression (HARD invariant #3) — keyed by email, outlives this thread/lead row.
      await suppressEmail(thread.ownerId, lead.email, `reply: ${decision.reason ?? decision.intent ?? 'opt_out'}`);
      break;
    case 'escalate':
      await setNeedsHuman(thread.id, true);
      break;
  }
  for (const r of unhandled) await markReplyHandled(r.id);
  await logRun(
    'info',
    'nurture_reply_decided',
    { threadId: thread.id, leadId: thread.leadId, action: decision.action, intent: decision.intent },
    thread.ownerId,
  ).catch(() => {});
};

// Plan + kick off ONE thread's next due touch. Creates the run (planned → executed), which halts at
// its email_agent or scheduler approval gate — NEVER sends. Throws on a planning failure so the
// caller requeues the thread instead of losing the claim silently.
const planAndKickoffTouch = async (thread: LeadNurtureThread, now: Date, opts: ExecuteOptions): Promise<void> => {
  const sequence = getSequence(thread.sequenceId);
  const touch = nextTouch(sequence, thread.touchNumber);
  if (!touch) {
    // Sequence already exhausted (defensive — advance already completes the thread on the last
    // send), so a stale claim can't loop forever.
    await advanceThread(thread.id, { touchNumber: thread.touchNumber, nextPlanAt: null, status: 'completed' });
    return;
  }
  const lead = await getLead(thread.leadId, thread.ownerId);
  if (!lead || !lead.email.trim()) {
    await advanceThread(thread.id, { touchNumber: thread.touchNumber, nextPlanAt: null, status: 'failed' });
    logger.warn('nurture_lead_unusable', { threadId: thread.id, leadId: thread.leadId });
    return;
  }

  const scheduleAt = touch.index === 0 ? null : now;
  const goal = buildTouchGoal(thread, lead, touch.stage, scheduleAt);
  const plan = planWorkflow(goal);
  if (!plan.ok) throw new Error(`nurture_plan_failed: ${plan.error}`);

  const run = await createRun({ ownerId: thread.ownerId, goal, plan: plan.plan, status: 'planned' });
  await createNodes(
    run.id,
    thread.ownerId,
    plan.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })),
  );
  const outcome = await runWorkflow(run.id, thread.ownerId, goal, plan.plan, opts);
  if (outcome.status !== 'needs_approval') {
    // email_agent/scheduler always requiresApproval, so a healthy touch always parks here. Anything
    // else (failed/aborted/completed) means something is wrong — surface it loudly instead of
    // silently recording a touch that nothing actually gated.
    throw new Error(`nurture_touch_did_not_park: run=${run.id} status=${outcome.status}`);
  }
  await createTouch({
    threadId: thread.id,
    ownerId: thread.ownerId,
    index: touch.index,
    stage: touch.stage,
    runId: run.id,
    status: 'awaiting_approval',
    scheduledAt: scheduleAt,
  });
  await logRun(
    'info',
    'nurture_touch_planned',
    { threadId: thread.id, leadId: thread.leadId, touchIndex: touch.index, runId: run.id },
    thread.ownerId,
  ).catch(() => {});
};

// Reconcile ONE parked touch against its run's live status. Returns true when the thread was
// advanced (sent or failed) — false while still waiting on a human approval. Exported (Phase 04) so
// the Nurture Inbox's approve endpoint can reconcile IMMEDIATELY after waiving a gate, instead of
// waiting on the next cron tick — safe to call redundantly: once a touch leaves ['awaiting_approval',
// 'scheduled'] the periodic sweep's pendingTouches() query no longer selects it, so there's no double-
// advance race between the router and the cron.
export const advanceOneTouch = async (touch: NurtureTouch, now: Date): Promise<boolean> => {
  if (!touch.runId) return false;
  const run = await getRunForOwner(touch.runId, touch.ownerId);
  if (!run) return false;

  if (run.status === 'failed' || run.status === 'aborted' || run.status === 'cancelled') {
    await setTouchStatus(touch.id, 'failed');
    await advanceThread(touch.threadId, { touchNumber: touch.index, nextPlanAt: null, status: 'failed' });
    logger.warn('nurture_touch_failed', { touchId: touch.id, runId: touch.runId, runStatus: run.status });
    return true;
  }
  if (run.status === 'scheduled') {
    if (touch.status !== 'scheduled') await setTouchStatus(touch.id, 'scheduled');
    return false; // parked for the resumeDueRuns cron (Phase 04 approval) — nothing to advance yet
  }
  if (run.status !== 'completed') return false; // still parked awaiting approval

  const result = (await listArtifacts(touch.runId)).find((a) => a.type === 'email_result')?.data as
    | { sentIds?: Record<string, string> | null; threadIds?: Record<string, string> | null; messageIds?: Record<string, string> | null }
    | undefined;
  if (!result) {
    // Completed but no email_result — email_agent is the terminal action, so this shouldn't happen.
    // Fail closed rather than silently advancing a cadence nothing actually sent.
    await setTouchStatus(touch.id, 'failed');
    logger.warn('nurture_touch_completed_no_result', { touchId: touch.id, runId: touch.runId });
    return true;
  }

  const thread = await getThreadById(touch.threadId);
  if (!thread) return true;
  await setTouchStatus(touch.id, 'sent', { sentAt: now });
  const sequence = getSequence(thread.sequenceId);
  const gap = gapDaysAfter(sequence, touch.index);
  // Gmail threading (Phase 02): messageIds carries OUR RFC Message-ID of this send (what the NEXT
  // touch's In-Reply-To must reference); threadIds carries Gmail's own conversation id. Once a thread
  // id exists it never changes again, so keep it if this touch's result somehow omitted one (e.g. a
  // stubbed gmailSendFn in a test). sentIds is the legacy fallback for a pre-Phase-02 artifact shape.
  const lastMessageId = Object.values(result.messageIds ?? {})[0] ?? Object.values(result.sentIds ?? {})[0] ?? null;
  const gmailThreadId = Object.values(result.threadIds ?? {})[0] ?? thread.gmailThreadId ?? null;
  await advanceThread(thread.id, {
    touchNumber: touch.index + 1,
    nextPlanAt: gap === null ? null : new Date(now.getTime() + gap * MS_PER_DAY),
    status: gap === null ? 'completed' : undefined,
    gmailThreadId,
    lastMessageId,
  });
  await logRun(
    'info',
    'nurture_touch_sent',
    { threadId: thread.id, touchIndex: touch.index, runId: touch.runId },
    thread.ownerId,
  ).catch(() => {});
  return true;
};

export interface NurtureSweepResult {
  enrolled: number;
  advanced: number;
  repliesProcessed: number;
  planned: number;
  failed: number;
}

// One full sweep: enroll → advance parked touches → CONVERSATION branch (reply-first, Phase 03) →
// claim + plan up to maxPerTick due threads. `now`/`opts` are injectable so verify-nurture-drip.ts /
// verify-nurture-brain.ts can drive a deterministic, zero-spend timeline; production omits all three
// (real wall clock, real LLM/Gmail/brain seams). `brainCallFn` stubs the nurture brain's raw Gemini
// call specifically (distinct from opts.llmJsonFn, which stubs the DOWNSTREAM email_writer/email_agent
// run — the brain's own reasoning call is a separate seam, mirrors atria-brain's shape).
export const runNurtureOnce = async (
  now: Date = new Date(),
  maxPerTick: number = env.NURTURE_MAX_PER_TICK,
  opts: ExecuteOptions = {},
  brainCallFn?: RawGeminiCallFn,
): Promise<NurtureSweepResult> => {
  const result: NurtureSweepResult = { enrolled: 0, advanced: 0, repliesProcessed: 0, planned: 0, failed: 0 };
  result.enrolled = (await enrollEligibleLeads(now)).enrolled;

  for (const touch of await pendingTouches()) {
    try {
      if (await advanceOneTouch(touch, now)) result.advanced++;
    } catch (e) {
      logger.error('nurture_advance_failed', { touchId: touch.id, error: String(e).slice(0, 200) });
    }
  }

  // Conversation branch (Phase 03) — reply-first, BEFORE any proactive drip planning below. Bounded by
  // the same per-tick cap as touch planning (bounded LLM spend: only unhandled-reply threads reach the
  // brain, at most maxPerTick per sweep).
  for (let i = 0; i < maxPerTick; i++) {
    const thread = await claimReplyThread();
    if (!thread) break;
    try {
      await processReplyThread(thread, now, opts, brainCallFn);
      result.repliesProcessed++;
    } catch (e) {
      logger.error('nurture_reply_process_failed', { threadId: thread.id, error: String(e).slice(0, 200) });
      await requeueReplyThread(thread.id).catch(() => {});
    }
  }

  for (let i = 0; i < maxPerTick; i++) {
    const thread = await claimDueThread(now);
    if (!thread) break;
    try {
      await planAndKickoffTouch(thread, now, opts);
      result.planned++;
    } catch (e) {
      result.failed++;
      logger.error('nurture_plan_failed', { threadId: thread.id, error: String(e).slice(0, 200) });
      // Requeue with a short backoff so a transient failure retries instead of stalling forever
      // (the atomic claim already cleared nextPlanAt to null).
      await requeueThread(thread.id, new Date(now.getTime() + 5 * 60 * 1000)).catch(() => {});
    }
  }

  if (result.enrolled || result.advanced || result.repliesProcessed || result.planned || result.failed) logger.info('nurture_swept', { ...result });
  return result;
};
