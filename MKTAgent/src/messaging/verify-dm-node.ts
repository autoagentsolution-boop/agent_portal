// DM-node verification (Multi-channel Nurture Nodes Phase 01) — DRY: no LLM spend, ZERO real
// messages sent (no network call). Asserts: (1) a DM goal plans dm_writer→dm_agent with the publish
// gate, (2) the writer produces a valid dm_draft, (3) dm_agent REFUSES a non-opted-in contact loudly,
// (4) a DRY-RUN send (no dmSendFn override, no channel token configured) returns a simulated success
// with a synthetic id and never calls the network, (5) a double-send is idempotent (no second send),
// (6) an adapter failure fails the node, and (7) the registry routes every channel to its own adapter.
// Exits non-zero on any failure. Requires Postgres (:5433) — DmContact/DmMessage rows are real DB writes.
import { randomUUID } from 'node:crypto';
import { prisma } from '../db/client.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { planWorkflow } from '../orchestration/master/workflow-planner.ts';
import { agentIdList } from '../orchestration/schemas/workflow-plan.ts';
import { agentGate, getAgent } from '../orchestration/registry/agent-registry.ts';
import { dmDraft, dmResult } from '../orchestration/schemas/artifact-schemas.ts';
import { getRunner } from '../orchestration/executor/agent-runners.ts';
import type { RunnerContext } from '../orchestration/executor/agent-runners.ts';
import { getDmAdapter, sendDm } from './index.ts';
import { recordOptIn } from './opt-in-repo.ts';
import type { MessagingChannel, DmSendFn } from './types.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `dm-node-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const ownerId = user.id;
  try {
    console.log('Planner routing');
    const dmGoal = goalSpec.parse({
      outputs: { needsDirectMessage: true, needsTextPost: false, needsPublishing: false },
      slots: { dmChannel: 'telegram', dmTo: '123456789', angle: 'quick check-in' },
      provider: 'test',
    });
    const plan = planWorkflow(dmGoal);
    check('plans dm_writer→dm_agent', plan.ok && agentIdList(plan.plan).join('→') === 'dm_writer→dm_agent', plan.ok ? agentIdList(plan.plan) : plan.error);
    check('dm_agent requiresApproval + publish gate', getAgent('dm_agent')?.requiresApproval === true && agentGate('dm_agent') === 'publish');
    check('dm_agent requires dm_draft (mirrors email_agent)', Boolean(getAgent('dm_agent')?.requires.includes('dm_draft')));

    console.log('Regression — marketing/email goals unaffected by isPublishOnly change');
    const mktGoal = goalSpec.parse({ outputs: { needsTextPost: true, needsPublishing: true }, platforms: ['facebook'], slots: { product: 'Widget' }, provider: 'test' });
    const mktPlan = planWorkflow(mktGoal);
    check('marketing still plans concept_writer→publisher', mktPlan.ok && agentIdList(mktPlan.plan).includes('publisher'));
    const publishOnlyGoal = goalSpec.parse({ outputs: { needsTextPost: false, needsInfographic: false, needsVideo: false, needsStoryboard: false, needsPublishing: true }, slots: {}, provider: 'test' });
    const publishOnlyPlan = planWorkflow(publishOnlyGoal);
    check('publish-only-no-content still rejected', !publishOnlyPlan.ok && publishOnlyPlan.error === 'publish_only_no_content', publishOnlyPlan);

    console.log('dm_writer (DRY — stubbed LLM, 0 spend)');
    // wf_run.id / DmMessage.runId are @db.Uuid columns — use real UUIDs, not readable slugs.
    const baseCtx: RunnerContext = {
      runId: randomUUID(),
      ownerId,
      goal: dmGoal,
      upstream: {},
      llmJsonFn: async () => ({ body: 'Hey! Quick check-in — how are things going?' }),
    };
    const writer = await getRunner('dm_writer')(baseCtx);
    const draftOk = writer.type === 'dm_draft' && dmDraft.safeParse(writer.data).success;
    check('dm_writer produces a valid dm_draft', draftOk, writer.type);
    const draft = writer.data as { channel: string; to: string; body: string };
    check('draft addressed to the recipient on the right channel', draft.to === '123456789' && draft.channel === 'telegram', draft);

    console.log('dm_agent — opt-in REFUSAL (fail loud, no send attempted)');
    let refused = false;
    let neverCalledSendFn = true;
    const refusalSendFn: DmSendFn = async () => { neverCalledSendFn = false; return { ok: true, error: null, platformMessageId: 'should-not-be-called', dryRun: true }; };
    try {
      await getRunner('dm_agent')({ ...baseCtx, runId: randomUUID(), upstream: { dm_draft: draft }, dmSendFn: refusalSendFn });
    } catch (e) {
      refused = /not opted in/.test(String(e));
    }
    check('dm_agent refuses a non-opted-in contact', refused);
    check('the adapter/sendFn was never invoked on refusal', neverCalledSendFn);

    console.log('dm_agent — DRY-RUN send (opted-in, no dmSendFn override, no token configured)');
    await recordOptIn(ownerId, 'telegram', '123456789');
    const sendRunId = randomUUID();
    const sent = await getRunner('dm_agent')({ ...baseCtx, runId: sendRunId, upstream: { dm_draft: draft } });
    const sentParsed = dmResult.safeParse(sent.data);
    check('dm_agent produces a valid dm_result', sent.type === 'dm_result' && sentParsed.success);
    check('status = dry_run (simulated, no network call)', sentParsed.success && sentParsed.data.status === 'dry_run', sentParsed.success ? sentParsed.data : undefined);
    check('a synthetic platformMessageId was assigned', sentParsed.success && Boolean(sentParsed.data.platformMessageId?.startsWith('dryrun-')), sentParsed.success ? sentParsed.data.platformMessageId : undefined);

    console.log('dm_agent — double-send guard (idempotent re-entry)');
    let secondCallHit = false;
    const countingSendFn: DmSendFn = async (channel, input) => { secondCallHit = true; return { ok: true, error: null, platformMessageId: `should-not-run-${channel}-${input.to}`, dryRun: true }; };
    const second = await getRunner('dm_agent')({ ...baseCtx, runId: sendRunId, upstream: { dm_draft: draft }, dmSendFn: countingSendFn });
    check('re-running the same runId does not call the send seam again', !secondCallHit);
    const secondParsed = dmResult.safeParse(second.data);
    check(
      're-running returns the SAME prior result (idempotent)',
      secondParsed.success && sentParsed.success && secondParsed.data.platformMessageId === sentParsed.data.platformMessageId,
      { second: secondParsed.success ? secondParsed.data : second.data, first: sentParsed.success ? sentParsed.data : undefined },
    );

    console.log('dm_agent — adapter failure fails the node');
    let failedLoud = false;
    const failingSendFn: DmSendFn = async () => ({ ok: false, error: 'simulated_provider_error', platformMessageId: null, dryRun: false });
    try {
      await getRunner('dm_agent')({ ...baseCtx, runId: randomUUID(), upstream: { dm_draft: draft }, dmSendFn: failingSendFn });
    } catch (e) {
      failedLoud = /simulated_provider_error/.test(String(e));
    }
    check('adapter failure throws (node fails loud)', failedLoud);

    console.log('Registry routes every channel to its own adapter (DRY, no tokens configured)');
    for (const channel of ['whatsapp', 'telegram', 'zalo'] as MessagingChannel[]) {
      const adapter = getDmAdapter(channel);
      check(`getDmAdapter(${channel}) returns the ${channel} adapter`, adapter?.channel === channel);
      const res = await sendDm(channel, { ownerId, to: '000', body: 'registry routing check' });
      check(`sendDm(${channel}) is DRY-RUN by default (no token/flag configured)`, res.ok && res.dryRun === true, res);
    }

    console.log(failures === 0 ? '\nPASS — DM-node checks green (0 real messages, 0 LLM spend)' : `\nFAIL — ${failures} check(s) failed`);
  } finally {
    await prisma.dmMessage.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.dmContact.deleteMany({ where: { ownerId } }).catch(() => {});
    await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
  }
  process.exit(failures === 0 ? 0 : 1);
}

await main();
