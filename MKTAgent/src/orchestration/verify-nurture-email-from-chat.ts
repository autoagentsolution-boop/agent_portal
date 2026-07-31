// Verify P3 — Birthday/Nurture email by lead NAME from chat. Deterministic seams, NO real Gemini/email:
//   1. find_lead: 1 match → resolves recipient onto ctx (authoritative, server-side); >1 → asks (no
//      resolve); narrowed by domain → 1; unknown → none. Email masked before it reaches the model.
//   2. runEmailWriter (stubbed LLM): a leadId grounds the draft with the lead's NAME/context; no leadId →
//      no lead line. 0 spend.
//   3. runEmailAgent (stubbed Gmail): a send to a resolved lead stamps nurturedAt. 0 real send.
// The Gemini analyzer routing (name → email goal) is validated live in P6 (browser). One throwaway tenant,
// self-cleaned.  npx tsx src/orchestration/verify-nurture-email-from-chat.ts
import { prisma } from '../db/client.ts';
import { createLead, getLead } from '../db/repos/lead-repo.ts';
import { getThreadById, suppressEmail } from '../nurture/nurture-thread-repo.ts';
import { dispatchTool, type ToolContext } from './atria/atria-tools.ts';
import { getRunner } from './executor/agent-runners.ts';
import { goalSpec } from './schemas/goal-spec.ts';
import type { LlmJsonFn } from './master/llm-json.ts';
import type { GmailSendFn } from '../email/gmail-send.ts';

let failed = 0;
const ok = (cond: boolean, label: string, extra?: unknown): void => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`, cond || extra === undefined ? '' : JSON.stringify(extra));
  if (!cond) failed++;
};

const baseCtx = (ownerId: string): ToolContext => ({
  ownerId, message: 'email a lead', memoryContext: null, instructions: null, sessionId: null, priorGoal: null,
  existingRunId: null, searched: [], proposal: null, executeRunId: null, scheduleProposal: null, resolvedLead: null, messageLanguage: null,
});

const seedLead = (ownerId: string, name: string, email: string) => createLead({
  ownerId, name, email, phone: null, message: `interested — ${name}`, sourceProduct: 'Atria', source: 'form',
  calBookingUid: null, score: 60, scoreReasons: [],
});

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `p3-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const lam = await seedLead(user.id, 'Lam', 'lam@example.com');
    await seedLead(user.id, 'Nghiep', 'nghiep@gmail.com');
    await seedLead(user.id, 'Nghiep', 'nghiep@company.com'); // same name → ambiguous

    console.log('find_lead resolution');
    // 1 match → resolves onto ctx (server-side authoritative), masked email to the model.
    const ctx1 = baseCtx(user.id);
    const r1 = await dispatchTool('find_lead', { name: 'Lam' }, ctx1) as any;
    ok(r1.found === 1, 'single name → found 1', r1);
    ok(ctx1.resolvedLead?.leadId === lam.id && ctx1.resolvedLead?.email === 'lam@example.com', 'ctx.resolvedLead set to the real record', ctx1.resolvedLead);
    ok(r1.lead?.email_masked === 'l***@example.com', 'email masked to the model (first char + domain)', r1.lead);

    // >1 match → does NOT resolve; returns candidates for the brain to ask.
    const ctx2 = baseCtx(user.id);
    const r2 = await dispatchTool('find_lead', { name: 'Nghiep' }, ctx2) as any;
    ok(r2.found === 2, 'ambiguous name → found 2', r2);
    ok(ctx2.resolvedLead === null, 'ambiguous → NOT resolved (brain must ask)', ctx2.resolvedLead);
    ok(Array.isArray(r2.candidates) && r2.candidates.every((c: any) => c.email_masked.includes('***')), 'candidates masked', r2.candidates);

    // Narrow by domain → 1.
    const ctx3 = baseCtx(user.id);
    const r3 = await dispatchTool('find_lead', { name: 'Nghiep gmail' }, ctx3) as any;
    ok(r3.found === 1 && ctx3.resolvedLead?.email === 'nghiep@gmail.com', 'narrowed "Nghiep gmail" → the gmail lead', { r3, resolved: ctx3.resolvedLead });

    // Unknown → none.
    const ctx4 = baseCtx(user.id);
    const r4 = await dispatchTool('find_lead', { name: 'Zzz Nobody' }, ctx4) as any;
    ok(r4.found === 0 && ctx4.resolvedLead === null, 'unknown name → found 0, no resolve', r4);

    console.log('runEmailWriter grounding (stubbed LLM — 0 spend)');
    let captured = '';
    const captureLlm: LlmJsonFn = async (_sys, userText) => { captured = userText; return { subject: 'Happy Birthday', body: 'Happy birthday, Lam!' }; };
    const groundedGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'lam@example.com', angle: 'a warm birthday note', leadId: lam.id, language: 'en' }, provider: 'test' });
    const draft = await getRunner('email_writer')({ runId: 'r', ownerId: user.id, goal: groundedGoal, upstream: {}, llmJsonFn: captureLlm as never }) as any;
    ok(draft.type === 'email_draft' && draft.data.to[0] === 'lam@example.com', 'writer drafts to the resolved address', draft.data);
    ok(captured.includes('Recipient name: Lam'), 'draft prompt grounded with lead NAME', captured.slice(0, 200));
    ok(captured.includes('interested — Lam'), 'draft prompt grounded with lead message', captured.includes('interested'));

    // Control: no leadId → no lead grounding line.
    captured = '';
    const plainGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'x@y.com', angle: 'a note', language: 'en' }, provider: 'test' });
    await getRunner('email_writer')({ runId: 'r', ownerId: user.id, goal: plainGoal, upstream: {}, llmJsonFn: captureLlm as never });
    ok(!captured.includes('Recipient name:'), 'no leadId → no lead grounding line', captured.slice(0, 120));

    // An email to a LEAD goes to a COUNTERPARTY, so it must be in THEIR language. The workspace default
    // (`user.defaultLanguage`, 'en' for this fixture) is NOT an acceptable answer when the lead's own
    // words are available — that fallback is what sent an Indonesian lead a Vietnamese first touch (F13).
    console.log('runEmailWriter recipient-language contract (the lead\'s language, not the workspace default)');
    const langLead = async (name: string, email: string, message: string) => {
      const lead = await createLead({ ownerId: user.id, name, email, phone: null, message, sourceProduct: 'Atria', source: 'form', calBookingUid: null, score: 60, scoreReasons: [] });
      captured = '';
      const goal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: email, angle: 'a warm thank-you', leadId: lead.id }, provider: 'test' });
      await getRunner('email_writer')({ runId: 'r', ownerId: user.id, goal, upstream: {}, llmJsonFn: captureLlm as never });
      return captured;
    };

    // Non-Latin lead message → the script detector names it outright.
    const viPrompt = await langLead('Tuan', 'tuan@example.com', 'Tôi muốn tìm hiểu thêm về khóa học của bạn');
    ok(viPrompt.includes('in this language: vi'), 'Vietnamese lead → writer pinned to vi', viPrompt.slice(-160));
    ok(!viPrompt.includes('in this language: en'), 'Vietnamese lead → workspace default NOT used', viPrompt.slice(-160));

    // Latin-script lead message: no code can tell Indonesian from English, so the writer must be told to
    // MIRROR the quoted message — pinning any named language here is the F13 defect.
    const idPrompt = await langLead('Budi', 'budi@example.com', 'Saya tertarik dengan kursus ini, tolong kirim harga dan jadwalnya');
    ok(idPrompt.includes('SAME language as the recipient'), 'Latin-script lead → writer told to mirror the lead', idPrompt.slice(-200));
    ok(!/in this language: (en|vi)\./.test(idPrompt), 'Latin-script lead → no language pinned from the workspace default', idPrompt.slice(-200));

    // The owner stating a language still wins — that is their explicit intent for this content.
    captured = '';
    const askedGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'lam@example.com', angle: 'a note', leadId: lam.id, language: 'ko' }, provider: 'test' });
    await getRunner('email_writer')({ runId: 'r', ownerId: user.id, goal: askedGoal, upstream: {}, llmJsonFn: captureLlm as never });
    ok(captured.includes('in this language: ko'), 'an explicit goal language still wins over the lead', captured.slice(-160));

    console.log('runEmailAgent nurture stamp (stubbed Gmail — 0 real send)');
    const sendStub: GmailSendFn = async () => ({ id: 'stub-msg-1' });
    const sendGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'lam@example.com', leadId: lam.id, language: 'en' }, provider: 'test' });
    const sent = await getRunner('email_agent')({ runId: 'r', ownerId: user.id, goal: sendGoal, upstream: { email_draft: { to: ['lam@example.com'], subject: 'Hi', body: 'Happy birthday!' } }, gmailSendFn: sendStub }) as any;
    ok(sent.data.status === 'sent', 'email_agent reports sent', sent.data);
    // markLeadNurtured is fire-and-forget; let the microtask settle before reading.
    await new Promise((r) => setTimeout(r, 50));
    const after = await getLead(lam.id, user.id);
    ok(after?.nurturedAt != null, 'lead stamped nurturedAt after send', after?.nurturedAt);

    // ── P4 characterization: email_agent gmail THREADING + runner-level OPT-OUT (HARD invariants #6 + #3).
    //    A Phase-3 email-family split must preserve (a) reusing a nurture thread's stored Gmail ids so a
    //    reply collapses into the existing conversation, and (b) the pre-send suppression gate that blocks
    //    an opted-out recipient and fails LOUD when everyone is suppressed.
    console.log('runEmailAgent threading + opt-out (P4)');
    // A GmailSendFn stub that captures the (raw, threadId) it receives so we can assert threading without
    // decoding MIME. threadId is passed through verbatim from nurtureThread.gmailThreadId.
    const capture: { raw?: string; threadArg?: string } = {};
    const captureSend: GmailSendFn = async (raw, _owner, threadId) => { capture.raw = raw; capture.threadArg = threadId; return { id: 'sent-1', threadId: threadId ?? 'srv-thread' }; };
    const decodeRaw = (raw?: string): string => (raw ? Buffer.from(raw, 'base64url').toString('utf8') : '');

    // Thread WITH stored gmail ids → threading carried: threadId arg = gmailThreadId; In-Reply-To/References = lastMessageId.
    const threadedLead = await seedLead(user.id, 'Threaded', 'threaded@example.com');
    const thread = await prisma.leadNurtureThread.create({
      data: { ownerId: user.id, leadId: threadedLead.id, sequenceId: 'default3', status: 'active', mode: 'drip',
        gmailThreadId: 'gmail-thread-abc', lastMessageId: '<prev-msg-99@mktagent.local>' },
    });
    const threadedGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'threaded@example.com', leadId: threadedLead.id, nurtureThreadId: thread.id, language: 'en' }, provider: 'test' });
    await getRunner('email_agent')({ runId: 'r', ownerId: user.id, goal: threadedGoal, upstream: { email_draft: { to: ['threaded@example.com'], subject: 'Re: hi', body: 'Following up.' } }, gmailSendFn: captureSend }) as any;
    ok(capture.threadArg === 'gmail-thread-abc', 'P4: reply carries the stored gmailThreadId (collapses into the thread)', capture.threadArg);
    const rawHdr = decodeRaw(capture.raw);
    ok(rawHdr.includes('In-Reply-To: <prev-msg-99@mktagent.local>'), 'P4: In-Reply-To = the thread lastMessageId', rawHdr.slice(0, 200));
    ok(rawHdr.includes('References: <prev-msg-99@mktagent.local>'), 'P4: References = the thread lastMessageId', rawHdr.slice(0, 200));
    ok(rawHdr.includes('List-Unsubscribe:'), 'P4: a nurture send (nurtureThreadId present) carries List-Unsubscribe', rawHdr.slice(0, 300));

    // Fresh conversation: a plain send (NO nurtureThreadId) → threadId undefined, no threading headers, no unsubscribe footer.
    capture.raw = undefined; capture.threadArg = undefined;
    const plainSendGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'threaded@example.com', leadId: threadedLead.id, language: 'en' }, provider: 'test' });
    await getRunner('email_agent')({ runId: 'r', ownerId: user.id, goal: plainSendGoal, upstream: { email_draft: { to: ['threaded@example.com'], subject: 'Hi', body: 'First touch.' } }, gmailSendFn: captureSend }) as any;
    ok(capture.threadArg === undefined, 'P4: plain send (no nurtureThreadId) → no threadId (new conversation)', capture.threadArg);
    const plainHdr = decodeRaw(capture.raw);
    ok(!plainHdr.includes('In-Reply-To:') && !plainHdr.includes('List-Unsubscribe:'), 'P4: plain send has no threading/unsubscribe headers', plainHdr.slice(0, 200));

    // Opt-out: suppress the only recipient → the runner throws LOUD (never a silent no-op).
    const suppressedLead = await seedLead(user.id, 'OptedOut', 'optout@example.com');
    await suppressEmail(user.id, 'optout@example.com', 'unsubscribed');
    const optGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'optout@example.com', leadId: suppressedLead.id, language: 'en' }, provider: 'test' });
    let optThrew: string | null = null;
    try {
      await getRunner('email_agent')({ runId: 'r', ownerId: user.id, goal: optGoal, upstream: { email_draft: { to: ['optout@example.com'], subject: 'Hi', body: 'Hello.' } }, gmailSendFn: captureSend });
    } catch (e) { optThrew = e instanceof Error ? e.message : String(e); }
    ok(optThrew != null && /opted out/i.test(optThrew), 'P4: all-suppressed send throws LOUD (/opted out/)', optThrew);

    // Partial suppression: one of two recipients suppressed → the survivor is sent, status stays 'sent'
    //    (the FILTERED recipient list drives the partial/sent decision, so a dropped opt-out ≠ partial).
    capture.raw = undefined;
    const partialGoal = goalSpec.parse({ outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false }, slots: { emailTo: 'optout@example.com, threaded@example.com', language: 'en' }, provider: 'test' });
    const partial = await getRunner('email_agent')({ runId: 'r', ownerId: user.id, goal: partialGoal, upstream: { email_draft: { to: ['optout@example.com', 'threaded@example.com'], subject: 'Hi', body: 'Hello.' } }, gmailSendFn: captureSend }) as any;
    ok(partial.data.status === 'sent' && partial.data.to.length === 1 && partial.data.to[0] === 'threaded@example.com',
      'P4: partial suppression drops the opted-out recipient, sends the survivor, status=sent', partial.data);
  } finally {
    await prisma.lead.deleteMany({ where: { ownerId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
}

void main();
