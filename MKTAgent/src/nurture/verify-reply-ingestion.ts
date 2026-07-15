// Verify Lead Nurture Agent Phase 02 — Gmail reply ingestion + threading capture. DRY-RUN: fixture
// Gmail payloads only, NO live Gmail API call (gmail-read.ts's listThreadMessages/hasGmailReadScope
// are both injected). Covers:
//   A. genuine-reply match by threadId, dedup on gmailMessageId, skip self/auto/bulk/unrelated, body
//      decrypted-on-read but never stored as plaintext, hasUnhandledReply flips true on ingest
//   B. missing/erroring read scope degrades the poll tick instead of crashing it (HARD invariant #5)
//   C. the real send path (agent-runners.ts/nurture-runner.ts) actually captures gmailThreadId and
//      carries In-Reply-To into the NEXT touch's send (HARD invariants #5 and #6)
//   npx tsx src/nurture/verify-reply-ingestion.ts
import { prisma } from '../db/client.ts';
import { createLead } from '../db/repos/lead-repo.ts';
import { getRunForOwner } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from '../orchestration/executor/workflow-executor.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { runNurtureOnce } from './nurture-runner.ts';
import { DEFAULT_SEQUENCE } from './sequence.ts';
import { pollNurtureReplies } from './nurture-reply-poller.ts';
import type { GmailListFn, GmailMessage } from './gmail-read.ts';
import type { GmailSendFn } from '../email/gmail-send.ts';
import type { RawGeminiCallFn } from './nurture-brain.ts';
import { isEncrypted } from '../lib/crypto.ts';

// Section A leaves an un-processed hasUnhandledReply=true row behind (this script predates the Phase 03
// conversation branch and never intends to exercise it) — every runNurtureOnce call below stubs the
// brain call so THAT leftover state can never trigger a real Gemini call if the sweep happens to claim
// it (an empty tool-call response degrades the loop to a free, deterministic escalate).
const noBrainCall: RawGeminiCallFn = async () => ({ candidates: [{ content: { parts: [] } }] });

let failed = 0;
const ok = (cond: boolean, label: string, extra?: unknown): void => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`, cond || extra === undefined ? '' : JSON.stringify(extra));
  if (!cond) failed++;
};

const DAY = 24 * 60 * 60 * 1000;
const fixture = (over: Partial<GmailMessage> & { id: string }): GmailMessage => ({
  threadId: 'gm-thread-fixture',
  from: 'lead@example.com',
  receivedAt: new Date('2026-01-02T00:00:00Z'),
  bodyText: 'hi',
  isOutbound: false,
  isAutoReply: false,
  ...over,
});

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `nurture-reply-${Date.now()}@test.local`, defaultLanguage: 'en', nurtureEnabled: true },
  });
  const ownerId = user.id;
  try {
    // ── A. Fixture ingestion: match / dedup / skip-self / skip-auto / skip-bulk / skip-unrelated ──
    console.log('A. fixture reply ingestion');
    const lead = await createLead({
      ownerId, name: 'Reply Lead', email: 'lead@example.com', phone: null, message: 'interested',
      sourceProduct: 'Atria', source: 'form', calBookingUid: null, score: 60, scoreReasons: [],
    });
    const thread = await prisma.leadNurtureThread.create({
      data: {
        ownerId, leadId: lead.id, sequenceId: DEFAULT_SEQUENCE.id, status: 'active',
        gmailThreadId: 'gm-thread-fixture', lastMessageId: '<touch0@mktagent.local>',
      },
    });

    const fixtures: GmailMessage[] = [
      fixture({ id: 'm-outbound', isOutbound: true, from: 'me@owner.com', bodyText: 'our own touch 0' }),
      fixture({ id: 'm-auto', isAutoReply: true, bodyText: 'out of office' }),
      fixture({ id: 'm-bulk', isAutoReply: true, bodyText: 'newsletter digest' }), // from==lead but bulk/auto
      fixture({ id: 'm-reply-1', bodyText: 'Sounds great, tell me more!' }),
      fixture({ id: 'm-unrelated', from: 'someoneelse@x.com', bodyText: 'cc-ed noise' }),
    ];
    const listMessages: GmailListFn = async (_owner, threadId) => (threadId === 'gm-thread-fixture' ? fixtures : []);
    const hasScope = async () => true;

    const poll1 = await pollNurtureReplies(listMessages, hasScope, new Date('2026-01-02T01:00:00Z'), ownerId);
    ok(poll1.threadsPolled === 1, 'polled exactly the one nurtured thread', poll1);
    ok(poll1.messagesScanned === 5, 'scanned all 5 fixture messages', poll1);
    ok(poll1.repliesIngested === 1, 'ingested exactly ONE genuine reply (skipped outbound/auto/bulk/unrelated)', poll1);

    const rows = await prisma.inboundReply.findMany({ where: { threadId: thread.id } });
    ok(rows.length === 1, 'exactly one InboundReply row persisted', rows.length);
    ok(rows[0]?.gmailMessageId === 'm-reply-1', 'persisted the genuine reply, not a skipped one', rows[0]);
    ok(isEncrypted(rows[0]?.bodyEnc ?? ''), 'body stored as AES-256-GCM ciphertext, not plaintext', rows[0]?.bodyEnc?.slice(0, 12));
    ok(rows[0]?.bodyEnc !== 'Sounds great, tell me more!', 'ciphertext is not literally the plaintext body');

    const threadAfter1 = await prisma.leadNurtureThread.findUniqueOrThrow({ where: { id: thread.id } });
    ok(threadAfter1.hasUnhandledReply === true, 'hasUnhandledReply flips true on genuine ingest', threadAfter1.hasUnhandledReply);
    ok(threadAfter1.lastCheckedAt !== null, 'lastCheckedAt stamped after the poll');

    console.log('A2. re-poll the SAME messages — dedup, no double-ingest');
    const poll2 = await pollNurtureReplies(listMessages, hasScope, new Date('2026-01-02T02:00:00Z'), ownerId);
    ok(poll2.repliesIngested === 0, 'second poll of identical messages ingests nothing new (unique gmailMessageId)', poll2);
    const rowsAfter2 = await prisma.inboundReply.findMany({ where: { threadId: thread.id } });
    ok(rowsAfter2.length === 1, 'still exactly one row after re-poll', rowsAfter2.length);

    // ── B. Missing/erroring read scope degrades, never throws (HARD invariant #5) ─────────────────
    console.log('B. missing/erroring read scope degrades the tick, never crashes it');
    const noScope = async () => false;
    const pollNoScope = await pollNurtureReplies(listMessages, noScope, new Date(), ownerId);
    ok(pollNoScope.scopeMissing === 1 && pollNoScope.threadsPolled === 0, 'no read scope → owner skipped, thread untouched', pollNoScope);

    const scopeProbeThrows = async () => { throw new Error('ETIMEDOUT'); };
    const pollProbeErr = await pollNurtureReplies(listMessages, scopeProbeThrows, new Date(), ownerId);
    ok(pollProbeErr.ownersScanned === 1 && pollProbeErr.threadsPolled === 0, 'scope-probe error skips the owner without throwing', pollProbeErr);

    const fetchThrows: GmailListFn = async () => { throw new Error('429 rate limited'); };
    const threadBeforeFetchErr = await prisma.leadNurtureThread.findUniqueOrThrow({ where: { id: thread.id } });
    const pollFetchErr = await pollNurtureReplies(fetchThrows, hasScope, new Date(), ownerId);
    ok(pollFetchErr.threadsPolled === 1 && pollFetchErr.repliesIngested === 0, 'a per-thread fetch failure is swallowed, not thrown', pollFetchErr);
    const threadAfterFetchErr = await prisma.leadNurtureThread.findUniqueOrThrow({ where: { id: thread.id } });
    ok(
      threadAfterFetchErr.lastCheckedAt?.getTime() === threadBeforeFetchErr.lastCheckedAt?.getTime(),
      'lastCheckedAt left untouched on a fetch failure (retried next tick)',
    );

    // ── C. Real send path captures gmailThreadId + carries In-Reply-To into the next touch ────────
    console.log('C. gmailThreadId + threading headers captured on the real send path (invariants #5, #6)');
    const captured: Array<{ raw: string; threadId?: string }> = [];
    let sendCount = 0;
    const threadingGmailSendFn: GmailSendFn = async (raw, _owner, threadId) => {
      sendCount++;
      captured.push({ raw, threadId });
      return { id: `gm-msg-${sendCount}`, threadId: threadId ?? 'gm-thread-NEW' }; // Gmail always assigns one
    };
    const opts: ExecuteOptions = {
      llmJsonFn: async () => ({ subject: 'Hi', body: 'Personalized nurture body.' }),
      gmailSendFn: threadingGmailSendFn,
    };
    const approveNode = async (runId: string, oid: string, nodeId: string) => {
      const run = await getRunForOwner(runId, oid);
      if (!run) throw new Error('run missing');
      const goal = goalSpec.parse(run.goal);
      const plan = workflowPlan.parse(run.plan);
      return runWorkflow(runId, oid, goal, plan, { ...opts, approveNodeId: nodeId });
    };

    const lead2 = await createLead({
      ownerId, name: 'Threading Lead', email: 'threading-lead@example.com', phone: null, message: 'hi',
      sourceProduct: 'Atria', source: 'form', calBookingUid: null, score: 60, scoreReasons: [],
    });
    const t0 = new Date('2026-02-01T00:00:00.000Z');
    await runNurtureOnce(t0, 10, opts, noBrainCall); // enrolls lead2 + plans + kicks off touch 0 (parks at email_agent)
    const thread2 = await prisma.leadNurtureThread.findFirstOrThrow({ where: { ownerId, leadId: lead2.id } });
    const touch0 = await prisma.nurtureTouch.findFirstOrThrow({ where: { threadId: thread2.id, index: 0 } });
    const run0 = await getRunForOwner(touch0.runId!, ownerId);
    const plan0 = workflowPlan.parse(run0!.plan);
    const emailNode0 = plan0.nodes.find((n) => n.agentId === 'email_agent')!.nodeId;
    ok(sendCount === 0, 'touch 0 not sent until explicitly approved');
    await approveNode(touch0.runId!, ownerId, emailNode0);
    ok(sendCount === 1, 'touch 0 sent once approved');
    ok(!captured[0]?.threadId, 'touch 0 had no prior thread to carry — plain send');

    await runNurtureOnce(t0, 10, opts, noBrainCall); // advance sweep: reconciles touch 0 → persists gmailThreadId/lastMessageId
    const thread2AfterTouch0 = await prisma.leadNurtureThread.findUniqueOrThrow({ where: { id: thread2.id } });
    ok(
      thread2AfterTouch0.gmailThreadId === 'gm-thread-NEW',
      'gmailThreadId captured from the send result onto the thread', thread2AfterTouch0.gmailThreadId,
    );
    ok(
      !!thread2AfterTouch0.lastMessageId && thread2AfterTouch0.lastMessageId.startsWith('<'),
      'lastMessageId captured as OUR generated RFC Message-ID', thread2AfterTouch0.lastMessageId,
    );

    const t1 = new Date(t0.getTime() + 3 * DAY);
    await runNurtureOnce(t1, 10, opts, noBrainCall); // plans + kicks off touch 1 (parks at scheduler, then email_agent)
    const touch1 = await prisma.nurtureTouch.findFirstOrThrow({ where: { threadId: thread2.id, index: 1 } });
    const run1 = await getRunForOwner(touch1.runId!, ownerId);
    const plan1 = workflowPlan.parse(run1!.plan);
    await approveNode(touch1.runId!, ownerId, plan1.nodes.find((n) => n.agentId === 'scheduler')!.nodeId);
    await approveNode(touch1.runId!, ownerId, plan1.nodes.find((n) => n.agentId === 'email_agent')!.nodeId);
    ok(sendCount === 2, 'touch 1 sent once approved');
    ok(captured[1]?.threadId === 'gm-thread-NEW', 'touch 1 reused the SAME Gmail threadId (invariant #6)', captured[1]?.threadId);
    const decoded1 = Buffer.from(captured[1]!.raw, 'base64url').toString('utf8');
    ok(
      decoded1.includes(`In-Reply-To: ${thread2AfterTouch0.lastMessageId}`),
      "touch 1 carries In-Reply-To = touch 0's Message-ID", decoded1.slice(0, 220),
    );
  } finally {
    await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed (cascades leads/threads/touches/replies/runs)');
  }

  console.log(failed === 0 ? '\nPASS — reply-ingestion + threading checks green (no live Gmail)' : `\nFAIL — ${failed} check(s) failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
