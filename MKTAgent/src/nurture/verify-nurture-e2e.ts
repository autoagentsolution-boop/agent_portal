// End-to-end verify for the Lead Nurture Agent — Phase 04 (Nurture Inbox + guardrails). DRY-RUN, 0 real
// sends, 0 real LLM spend. Exercises the SAME functions the Nurture Inbox's approve endpoint calls
// (src/api/nurture-router.ts): getRunWithNodes → optional updateArtifactData (edit) →
// guardrails.preSendCheck → runWorkflow(approveNodeId) → nurture-runner.advanceOneTouch — via a local
// `approveTouch` helper that mirrors the router's logic exactly (verify-nurture-drip.ts's own
// approveNode() helper set this precedent: "mirrors what the real /approve-node route + Phase 04's
// future approval inbox do"). Everything that could hit real Gemini is stubbed (llmJsonFn / a mock
// brainCallFn per HARD invariant of this phase — the driver's reply-claim scan is GLOBAL, so any
// thread left with hasUnhandledReply=true on a shared tenant would otherwise reach real Gemini).
//
// Covers: enroll → touch0 park → approve → send; touch1 parks WITH a scheduler gate (two approvals:
// confirm, then send) and edit-before-approve (the edited body is what actually "sends", verified by
// decoding the real outbound MIME); reply ingest → brain draft (seeded, zero extra LLM) → park →
// approve → send, in the SAME Gmail thread as the proactive touches; opt-out mid-thread cancels a
// PENDING touch + global suppression + blocks re-enroll + blocks a pre-send attempt; guardrails
// (max-touches / no-recipient / daily-cap) block directly; the unsubscribe signed link mints + verifies
// + rejects tampering; every real send traces to an explicit approval (no send bypasses the gate).
//   npx tsx src/nurture/verify-nurture-e2e.ts
import { prisma } from '../db/client.ts';
import { createLead, getLead } from '../db/repos/lead-repo.ts';
import { getRunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from '../orchestration/executor/workflow-executor.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { updateArtifactData } from '../orchestration/executor/artifact-store.ts';
import { runNurtureOnce, advanceOneTouch } from './nurture-runner.ts';
import { getThreadById, getTouchForOwner, isEmailSuppressed, enrollLead } from './nurture-thread-repo.ts';
import { preSendCheck, buildUnsubscribeUrl, verifyUnsubscribeToken } from './guardrails.ts';
import { getSequence, DEFAULT_SEQUENCE } from './sequence.ts';
import { upsertInboundReply } from './reply-repo.ts';
import type { RawGeminiCallFn } from './nurture-brain.ts';
import type { NurtureTouch } from '../../prisma/generated/prisma/client.ts';

let failed = 0;
const ok = (cond: boolean, label: string, extra?: unknown): void => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`, cond || extra === undefined ? '' : JSON.stringify(extra));
  if (!cond) failed++;
};

const DAY = 24 * 60 * 60 * 1000;

// ── Test "LLM" for the nurture brain (mirrors verify-nurture-brain.ts's mockBrain) ─────────────────────
const envelope = (calls: Array<{ name: string; args: Record<string, unknown> }>) => ({
  candidates: [{ content: { parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) } }],
});
const mockBrain = (marker: string, calls: Array<{ name: string; args: Record<string, unknown> }>): RawGeminiCallFn =>
  async (contents) => envelope(JSON.stringify(contents).includes(marker) ? calls : []);
const mustNotCallLlm: RawGeminiCallFn = async () => { throw new Error('deterministic opt-out must not call the LLM'); };

// ── Send capture: sendCount is the ONLY source of truth for "did a real send happen"; lastRaw/
// lastThreadIdArg let assertions decode the actual outbound MIME + verify in-thread continuity. ──────
let sendCount = 0;
let lastRaw: string | null = null;
let lastThreadIdArg: string | undefined;
const capture = (raw: string, threadId?: string) => { sendCount++; lastRaw = raw; lastThreadIdArg = threadId; };

// gmail-send.ts's buildRaw base64-ENCODES the body separately (Content-Transfer-Encoding: base64) THEN
// base64url-encodes the whole RFC822 message for the Gmail API — decoding `raw` once only recovers the
// HEADERS as plain text; the body line is still base64. rfc822Text() gives the outer decode (for header
// assertions like List-Unsubscribe); sentBody() also decodes the body segment (for content assertions).
const rfc822Text = (raw: string): string => Buffer.from(raw, 'base64url').toString('utf8');
const sentBody = (raw: string): string => {
  const msg = rfc822Text(raw);
  const bodyB64 = msg.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return Buffer.from(bodyB64, 'base64').toString('utf8');
};

// Drip-touch opts (email_writer calls its own LLM for a proactive touch — not seeded).
const opts: ExecuteOptions = {
  llmJsonFn: async () => ({ subject: 'Original subject', body: 'Original nurture body.' }),
  gmailSendFn: async (raw, _ownerId, threadId) => { capture(raw, threadId); return { id: `stub-${sendCount}`, threadId: 'stub-thread' }; },
};
// Reply opts — a reply's draft is SEEDED by the brain (email_writer skips its own LLM call), so a call
// here is a regression (a second, un-audited LLM call bypassing the brain's guardrails).
const replyOpts: ExecuteOptions = {
  llmJsonFn: async () => { throw new Error('email_writer must not call the LLM for a seeded nurture-brain reply'); },
  gmailSendFn: async (raw, _ownerId, threadId) => { capture(raw, threadId); return { id: `stub-${sendCount}`, threadId: 'stub-thread' }; },
};

// ── approveTouch — mirrors src/api/nurture-router.ts's POST /threads/:id/approve handler function-for-
// function (same call sequence, same guardrail placement), so this verify exercises the REAL Phase 04
// composition rather than re-deriving looser assertions against the router's HTTP surface. ──────────
// `now` is injectable (default real wall clock, matching the production router) so this verify can
// drive a deterministic synthetic timeline — same rationale as runNurtureOnce/advanceOneTouch's own
// injectable `now` (nurture-runner.ts).
let approvedSendCalls = 0;
const approveTouch = async (
  touch: NurtureTouch,
  ownerId: string,
  execOpts: ExecuteOptions,
  edited?: { subject?: string; body?: string },
  now: Date = new Date(),
): Promise<{ status: string; blocked?: string; gateAgentId: string }> => {
  if (!touch.runId) throw new Error('touch has no run');
  const run = await getRunWithNodes(touch.runId, ownerId);
  if (!run) throw new Error('run not found');
  if (run.status !== 'needs_approval') throw new Error(`run not awaiting approval (${run.status})`);
  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  if (!gateNode) throw new Error('no gate node');

  if (edited) {
    const draftArtifact = run.artifacts.find((a) => a.type === 'email_draft');
    if (!draftArtifact) throw new Error('no draft to edit');
    const current = draftArtifact.data as { to: string[]; subject: string; body: string; groundedOn: string | null };
    await updateArtifactData(draftArtifact.id, ownerId, 'email_draft', {
      ...current,
      subject: edited.subject ?? current.subject,
      body: edited.body ?? current.body,
    });
  }

  const thread = await getThreadById(touch.threadId);
  if (!thread) throw new Error('thread missing');
  const lead = await getLead(thread.leadId, ownerId);
  if (!lead) throw new Error('lead missing');
  const maxTouches = getSequence(thread.sequenceId).touches.length;
  const guard = await preSendCheck(ownerId, lead.email, touch.index, maxTouches);
  if (!guard.ok) return { status: 'blocked', blocked: guard.reason, gateAgentId: gateNode.agentId };

  const goal = goalSpec.parse(run.goal);
  const plan = workflowPlan.parse(run.plan);
  const outcome = await runWorkflow(run.id, ownerId, goal, plan, { ...execOpts, approveNodeId: gateNode.nodeId });
  const fresh = (await getTouchForOwner(touch.id, ownerId)) ?? touch;
  await advanceOneTouch(fresh, now);
  if (outcome.status === 'completed' && gateNode.agentId === 'email_agent') approvedSendCalls++;
  return { status: outcome.status, gateAgentId: gateNode.agentId };
};

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `nurture-e2e-${Date.now()}@test.local`, defaultLanguage: 'en', nurtureEnabled: true },
  });
  const ownerId = user.id;
  try {
    const lead = await createLead({
      ownerId, name: 'E2E Lead', email: 'e2e-lead@example.com', phone: null,
      message: 'interested in the product', sourceProduct: 'Atria', source: 'form',
      calBookingUid: null, score: 70, scoreReasons: [],
    });
    const t0 = new Date('2026-02-01T00:00:00.000Z');

    console.log('touch 0 — enroll → park → approve → send');
    const sweep0 = await runNurtureOnce(t0, 10, opts);
    ok(sweep0.enrolled === 1 && sweep0.planned === 1, 'lead auto-enrolled and touch 0 planned', sweep0);
    ok(sendCount === 0, 'nothing sent yet — planning alone never sends (fail-closed)');
    const thread = await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId, leadId: lead.id } });
    let touch0 = await prisma.nurtureTouch.findFirstOrThrow({ where: { threadId: thread.id, index: 0 } });
    ok(touch0.status === 'awaiting_approval' && !!touch0.runId, 'touch 0 parked awaiting_approval', touch0);

    const approve0 = await approveTouch(touch0, ownerId, opts, undefined, t0);
    ok(approve0.status === 'completed' && approve0.gateAgentId === 'email_agent', 'approving the only gate sends touch 0', approve0);
    ok(sendCount === 1 && approvedSendCalls === 1, 'exactly one real send, via one explicit approval');
    touch0 = await prisma.nurtureTouch.findUniqueOrThrow({ where: { id: touch0.id } });
    ok(touch0.status === 'sent', 'touch 0 reconciled to sent immediately (no cron wait)', touch0);
    ok(sentBody(lastRaw!).includes('/leads/unsubscribe'), 'the sent email carries a footer unsubscribe link');
    ok(/List-Unsubscribe: </.test(rfc822Text(lastRaw!)), 'the sent email carries a List-Unsubscribe header');

    console.log('touch 1 (day 3) — TWO gates (schedule confirm, then send); edit-before-approve');
    const t1 = new Date(t0.getTime() + 3 * DAY);
    const sweep1 = await runNurtureOnce(t1, 10, opts);
    ok(sweep1.planned === 1, 'touch 1 planned once due', sweep1);
    let touch1 = await prisma.nurtureTouch.findFirstOrThrow({ where: { threadId: thread.id, index: 1 } });
    ok(touch1.status === 'awaiting_approval', 'touch 1 parked awaiting_approval', touch1);

    const approve1a = await approveTouch(touch1, ownerId, opts, undefined, t1); // clears the SCHEDULE gate only
    ok(approve1a.status === 'needs_approval' && approve1a.gateAgentId === 'scheduler', 'first approval clears the schedule gate, halts again at send', approve1a);
    ok(sendCount === 1, 'no send yet — only the schedule gate was cleared');

    const approve1b = await approveTouch(touch1, ownerId, opts, { subject: 'EDITED SUBJECT', body: 'EDITED BODY — the human rewrote this before sending.' }, t1);
    ok(approve1b.status === 'completed' && approve1b.gateAgentId === 'email_agent', 'second approval clears the send gate', approve1b);
    ok(sendCount === 2 && approvedSendCalls === 2, 'second real send, via its own explicit approval');
    const decoded1 = sentBody(lastRaw!);
    ok(decoded1.includes('EDITED BODY'), 'the SENT content is the edited body, not the original draft');
    ok(!decoded1.includes('Original nurture body'), 'the original (pre-edit) body was NOT what sent');
    ok(lastThreadIdArg === 'stub-thread', 'touch 1 sent into the SAME Gmail thread touch 0 started (in-thread)');
    touch1 = await prisma.nurtureTouch.findUniqueOrThrow({ where: { id: touch1.id } });
    ok(touch1.status === 'sent', 'touch 1 reconciled to sent', touch1);

    console.log('reply ingest → brain draft (seeded, zero extra LLM) → park → approve → send, in-thread');
    await upsertInboundReply({
      threadId: thread.id, gmailMessageId: 'stub-reply-1', fromEmail: 'e2e-lead@example.com',
      body: 'MARK_INTERESTED — sounds great, tell me more!', receivedAt: new Date(),
    });
    await prisma.leadNurtureThread.update({ where: { id: thread.id }, data: { hasUnhandledReply: true } });
    const brainReply = mockBrain('MARK_INTERESTED', [
      { name: 'classify_reply', args: { intent: 'interested', confidence: 0.9 } },
      { name: 'draft_reply', args: { subject: 'Great to hear!', body: 'BRAIN DRAFT BODY — happy to help, when works for a quick call?' } },
    ]);
    const sweepReply = await runNurtureOnce(t1, 10, replyOpts, brainReply);
    ok(sweepReply.repliesProcessed === 1, 'the reply reached the brain', sweepReply);
    const threadAfterReply = await prisma.leadNurtureThread.findUniqueOrThrow({ where: { id: thread.id } });
    ok(threadAfterReply.mode === 'conversation', 'a reply interrupts the drip (mode → conversation)');
    const replyTouch = await prisma.nurtureTouch.findFirstOrThrow({ where: { threadId: thread.id, stage: 'reply' } });
    ok(replyTouch.status === 'awaiting_approval' && !!replyTouch.runId, 'the reply draft parked awaiting_approval — never auto-sent', replyTouch);
    ok(sendCount === 2, 'drafting the reply sent nothing (still 2 from the touches above)');

    const approveReply = await approveTouch(replyTouch, ownerId, replyOpts, undefined, t1);
    ok(approveReply.status === 'completed' && approveReply.gateAgentId === 'email_agent', 'approving the reply draft sends it', approveReply);
    ok(sendCount === 3 && approvedSendCalls === 3, 'third real send, via its own explicit approval');
    ok(sentBody(lastRaw!).includes('BRAIN DRAFT BODY'), 'the sent reply is the brain\'s draft verbatim (no re-write)');
    ok(lastThreadIdArg === 'stub-thread', 'the reply sent into the SAME Gmail thread as the proactive touches');

    console.log('opt-out mid-thread — cancels a PENDING touch + global suppression, blocks re-enroll + pre-send');
    const optOutLead = await createLead({
      ownerId, name: 'OptOut Lead', email: 'e2e-optout@example.com', phone: null, message: 'hi',
      sourceProduct: 'Atria', source: 'form', calBookingUid: null, score: 50, scoreReasons: [],
    });
    // Still well before the primary thread's own next due date (t0+6d) — only the fresh lead is due.
    const sweepOptOutEnroll = await runNurtureOnce(t1, 10, opts);
    ok(sweepOptOutEnroll.enrolled === 1 && sweepOptOutEnroll.planned === 1, 'the opt-out-test lead auto-enrolled and its touch 0 planned', sweepOptOutEnroll);
    const optOutThreadRow = await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId, leadId: optOutLead.id } });
    const optOutTouch0 = await prisma.nurtureTouch.findFirstOrThrow({ where: { threadId: optOutThreadRow.id, index: 0 } });
    ok(optOutTouch0.status === 'awaiting_approval', 'its touch 0 is parked BEFORE the opt-out reply arrives');

    await upsertInboundReply({
      threadId: optOutThreadRow.id, gmailMessageId: 'stub-optout-1', fromEmail: 'e2e-optout@example.com',
      body: 'Please unsubscribe me, not interested.', receivedAt: new Date(),
    });
    await prisma.leadNurtureThread.update({ where: { id: optOutThreadRow.id }, data: { hasUnhandledReply: true } });
    const sweepOptOut = await runNurtureOnce(t1, 10, opts, mustNotCallLlm);
    ok(sweepOptOut.repliesProcessed === 1, 'opt-out reply processed with ZERO LLM calls (deterministic fast path)', sweepOptOut);
    const optOutThreadAfter = await prisma.leadNurtureThread.findUniqueOrThrow({ where: { id: optOutThreadRow.id } });
    ok(optOutThreadAfter.status === 'opted_out', 'thread status = opted_out', optOutThreadAfter.status);
    ok(await isEmailSuppressed(ownerId, 'e2e-optout@example.com'), 'email recorded in the GLOBAL suppression set');
    const optOutTouch0After = await prisma.nurtureTouch.findUniqueOrThrow({ where: { id: optOutTouch0.id } });
    ok(optOutTouch0After.status === 'skipped', 'the PENDING touch 0 was cancelled by the opt-out reply (mid-thread)', optOutTouch0After);
    ok(sendCount === 3, 'the opt-out flow sent nothing (still 3 — no send bypassed the cancel)');

    const reCaptured = await createLead({
      ownerId, name: 'Re-captured', email: 'e2e-optout@example.com', phone: null, message: null,
      sourceProduct: null, source: 'form', calBookingUid: null, score: 40, scoreReasons: [],
    });
    const blockedEnroll = await enrollLead(ownerId, reCaptured.id, DEFAULT_SEQUENCE.id, t1, 'e2e-optout@example.com');
    ok(blockedEnroll === null, 'a brand-new lead row with the suppressed email is refused enrollment');
    const guardOptOut = await preSendCheck(ownerId, 'e2e-optout@example.com', 0, 3);
    ok(!guardOptOut.ok && guardOptOut.reason === 'lead_opted_out', 'preSendCheck blocks the opted-out address at the last checkpoint too', guardOptOut);

    console.log('guardrails: max-touches / no-recipient / daily-cap block directly');
    const guardMax = await preSendCheck(ownerId, 'someone@example.com', 5, 3);
    ok(!guardMax.ok && guardMax.reason === 'max_touches_reached', 'blocks a touch index beyond the cadence length', guardMax);
    const guardEmpty = await preSendCheck(ownerId, '   ', 0, 3);
    ok(!guardEmpty.ok && guardEmpty.reason === 'no_recipient', 'blocks a blank recipient', guardEmpty);
    await prisma.nurtureTouch.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        threadId: thread.id, ownerId, index: 900 + i, stage: 'reply', status: 'sent', sentAt: new Date(),
      })),
    });
    const guardCap = await preSendCheck(ownerId, 'someone-else@example.com', 0, 3);
    ok(!guardCap.ok && guardCap.reason === 'daily_send_cap_reached', 'blocks once the owner\'s daily send cap is reached', guardCap);

    console.log('unsubscribe signed link — mints, verifies, rejects tampering');
    const link = buildUnsubscribeUrl(ownerId, 'link-test@example.com');
    ok(link.includes('/leads/unsubscribe') && link.includes('token='), 'the unsubscribe URL carries a signed token', link);
    const token = new URL(link).searchParams.get('token')!;
    ok(verifyUnsubscribeToken(ownerId, 'link-test@example.com', token), 'the minted token verifies for the SAME owner+email');
    ok(!verifyUnsubscribeToken(ownerId, 'someone-else@example.com', token), 'the token does NOT verify for a different email (scoped, unforgeable)');
    ok(!verifyUnsubscribeToken(ownerId, 'link-test@example.com', 'tampered-value'), 'a tampered token is rejected');

    console.log('no send without an approval record');
    ok(sendCount === approvedSendCalls, `every real send (${sendCount}) traces to an explicit approval that cleared the send gate (${approvedSendCalls})`, { sendCount, approvedSendCalls });
  } finally {
    await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed (cascades leads/threads/touches/replies/runs/suppressions)');
  }

  console.log(failed === 0 ? '\nPASS — nurture e2e checks green (0 real sends, 0 real LLM spend)' : `\nFAIL — ${failed} check(s) failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
