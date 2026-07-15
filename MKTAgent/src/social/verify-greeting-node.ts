// Greeting-node verification (Multi-channel Nurture Nodes Phase 02) — DRY: no LLM spend, ZERO real
// posts (no network call). Asserts: (1) a wall-greeting goal plans greeting_writer→greeting_agent
// with the publish gate, (2) the writer produces a valid greeting_draft and infers mention vs. reply
// correctly, (3) greetTo fans out to MULTIPLE platforms in a single call, (4) an unsupported action
// degrades to {ok:false,error:'unsupported'} — NEVER throws — for FB/IG reply and IG mention, (5) the
// X Mar-2026 prior-engagement rule degrades a standalone mention gracefully (no network call, no
// throw), (6) a double post is guarded (idempotent re-entry), and (7) an adapter failure fails the
// node loudly. Exits non-zero on any failure. Requires Postgres (:5433) — the idempotency guard reads/
// writes ExternalActionAuditLog rows (no new table for this phase).
import { randomUUID } from 'node:crypto';
import { prisma } from '../db/client.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { planWorkflow } from '../orchestration/master/workflow-planner.ts';
import { agentIdList } from '../orchestration/schemas/workflow-plan.ts';
import { agentGate, getAgent } from '../orchestration/registry/agent-registry.ts';
import { greetingDraft, greetingResult } from '../orchestration/schemas/artifact-schemas.ts';
import { getRunner } from '../orchestration/executor/agent-runners.ts';
import type { RunnerContext } from '../orchestration/executor/agent-runners.ts';
import { greetTo } from './greeting.ts';
import { xAdapter } from './x.ts';
import type { GreetFn } from './greeting.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const ownerId = randomUUID(); // ExternalActionAuditLog.ownerId has no FK — a synthetic id is fine.
  try {
    console.log('Planner routing');
    const greetGoal = goalSpec.parse({
      outputs: { needsWallGreeting: true, needsTextPost: false, needsPublishing: false },
      slots: { greetHandle: 'somebrand', angle: 'congratulate them on the launch' },
      platforms: ['x', 'threads'],
      provider: 'test',
    });
    const plan = planWorkflow(greetGoal);
    check(
      'plans greeting_writer→greeting_agent',
      plan.ok && agentIdList(plan.plan).join('→') === 'greeting_writer→greeting_agent',
      plan.ok ? agentIdList(plan.plan) : plan.error,
    );
    check('greeting_agent requiresApproval + publish gate', getAgent('greeting_agent')?.requiresApproval === true && agentGate('greeting_agent') === 'publish');
    check('greeting_agent requires greeting_draft (mirrors dm_agent)', Boolean(getAgent('greeting_agent')?.requires.includes('greeting_draft')));

    console.log('Regression — marketing/email/DM goals unaffected by the new branch + isPublishOnly guard');
    const mktGoal = goalSpec.parse({ outputs: { needsTextPost: true, needsPublishing: true }, platforms: ['facebook'], slots: { product: 'Widget' }, provider: 'test' });
    const mktPlan = planWorkflow(mktGoal);
    check('marketing still plans concept_writer→publisher', mktPlan.ok && agentIdList(mktPlan.plan).includes('publisher'));
    const dmGoal = goalSpec.parse({ outputs: { needsDirectMessage: true, needsTextPost: false, needsPublishing: false }, slots: { dmChannel: 'telegram', dmTo: '1' }, provider: 'test' });
    const dmPlan = planWorkflow(dmGoal);
    check('DM goal still plans dm_writer→dm_agent', dmPlan.ok && agentIdList(dmPlan.plan).join('→') === 'dm_writer→dm_agent');
    const publishOnlyGoal = goalSpec.parse({ outputs: { needsTextPost: false, needsInfographic: false, needsVideo: false, needsStoryboard: false, needsPublishing: true }, slots: {}, provider: 'test' });
    const publishOnlyPlan = planWorkflow(publishOnlyGoal);
    check('publish-only-no-content still rejected', !publishOnlyPlan.ok && publishOnlyPlan.error === 'publish_only_no_content', publishOnlyPlan);

    console.log('greeting_writer (DRY — stubbed LLM, 0 spend) — action inference');
    const baseCtx: RunnerContext = {
      runId: randomUUID(),
      ownerId,
      goal: greetGoal,
      upstream: {},
      llmJsonFn: async () => ({ body: 'Congrats on the launch, this looks great!' }),
    };
    const writer = await getRunner('greeting_writer')(baseCtx);
    const draftOk = writer.type === 'greeting_draft' && greetingDraft.safeParse(writer.data).success;
    check('greeting_writer produces a valid greeting_draft', draftOk, writer.type);
    const draft = writer.data as { action: string; target: string; body: string };
    check('mention inferred from greetHandle (no greetPostId set)', draft.action === 'mention' && draft.target === 'somebrand', draft);

    const replyGoal = goalSpec.parse({
      outputs: { needsWallGreeting: true, needsTextPost: false, needsPublishing: false },
      slots: { greetPostId: 'tweet-123', greetHandle: 'somebrand' }, // both set → reply wins
      platforms: ['x'],
      provider: 'test',
    });
    const replyWriter = await getRunner('greeting_writer')({ ...baseCtx, goal: replyGoal });
    const replyDraft = replyWriter.data as { action: string; target: string };
    check('reply wins over mention when both targets are set', replyDraft.action === 'reply' && replyDraft.target === 'tweet-123', replyDraft);

    console.log('greetTo — unsupported-action degrade (FB/IG reply, IG mention) — never throws');
    const fbReply = await greetTo('facebook', 'reply', { ownerId, postId: 'p1', body: 'hi' });
    check('facebook.reply → unsupported (no throw)', fbReply.ok === false && fbReply.error === 'unsupported', fbReply);
    const igReply = await greetTo('instagram', 'reply', { ownerId, postId: 'p1', body: 'hi' });
    check('instagram.reply → unsupported (no throw)', igReply.ok === false && igReply.error === 'unsupported', igReply);
    const igMention = await greetTo('instagram', 'mention', { ownerId, handle: 'someone', body: 'hi' });
    check('instagram.mention → unsupported (no throw, no media to attach)', igMention.ok === false && igMention.error === 'unsupported', igMention);
    const fbMention = await greetTo('facebook', 'mention', { ownerId, handle: 'someone', body: 'hi' });
    check('facebook.mention IS implemented (DRY-RUN simulated ok, not unsupported)', fbMention.ok === true && fbMention.error !== 'unsupported', fbMention);

    console.log('X adapter — Mar-2026 prior-engagement pre-check (adapter called directly, no network)');
    const xMentionDegrade = await xAdapter.mention!({ ownerId, handle: 'someone', body: 'hi' });
    check('x.mention degrades gracefully (standalone @mention blocked by policy)', xMentionDegrade.ok === false && /standalone/.test(xMentionDegrade.error ?? ''), xMentionDegrade);

    console.log('greetTo — fan-out to MULTIPLE platforms in a single greeting_agent run (DRY-RUN default, no live flag)');
    const fanCtx: RunnerContext = { ...baseCtx, runId: randomUUID(), upstream: { greeting_draft: draft }, goal: greetGoal };
    const posted = await getRunner('greeting_agent')(fanCtx);
    const postedParsed = greetingResult.safeParse(posted.data);
    check('greeting_agent produces a valid greeting_result', posted.type === 'greeting_result' && postedParsed.success, postedParsed.success ? undefined : posted.data);
    check('fanned out to both targeted platforms', postedParsed.success && postedParsed.data.results.length === 2, postedParsed.success ? postedParsed.data.results : undefined);
    check('status = dry_run (no live flag, no greetFn override)', postedParsed.success && postedParsed.data.status === 'dry_run', postedParsed.success ? postedParsed.data.status : undefined);
    check('every platform in the fan-out succeeded (simulated)', postedParsed.success && postedParsed.data.results.every((r) => r.ok), postedParsed.success ? postedParsed.data.results : undefined);

    console.log('greeting_agent — double-post guard (idempotent re-entry, same runId)');
    let secondCallHit = false;
    const countingGreetFn: GreetFn = async (platform) => { secondCallHit = true; return { platform, ok: true, url: `should-not-run-${platform}`, error: null }; };
    const second = await getRunner('greeting_agent')({ ...fanCtx, greetFn: countingGreetFn });
    check('re-running the same runId does not call greetFn again', !secondCallHit);
    const secondParsed = greetingResult.safeParse(second.data);
    check(
      're-running returns the SAME prior results (idempotent)',
      secondParsed.success && postedParsed.success && secondParsed.data.results.map((r) => r.url).join(',') === postedParsed.data.results.map((r) => r.url).join(','),
      { second: secondParsed.success ? secondParsed.data.results : second.data, first: postedParsed.success ? postedParsed.data.results : undefined },
    );

    console.log('greeting_agent — adapter failure on every platform fails the node');
    let failedLoud = false;
    const failingGreetFn: GreetFn = async (platform) => ({ platform, ok: false, url: null, error: 'simulated_provider_error' });
    try {
      await getRunner('greeting_agent')({ ...baseCtx, runId: randomUUID(), upstream: { greeting_draft: draft }, greetFn: failingGreetFn });
    } catch (e) {
      failedLoud = /simulated_provider_error/.test(String(e));
    }
    check('total adapter failure throws (node fails loud)', failedLoud);

    console.log('greeting_agent — approval gate parks before posting (executor halts on requiresApproval, not tested here directly)');
    check('gate flags confirmed above already prove the pre-post halt (requiresApproval + gate=publish)', getAgent('greeting_agent')?.requiresApproval === true);

    console.log('Registry — each adapter exposes exactly its supported mention/reply actions');
    const supportMatrix: Array<[SocialPlatform, boolean, boolean]> = [
      ['x', true, true],
      ['threads', true, true],
      ['facebook', true, false],
      ['instagram', false, false],
    ];
    for (const [platform, mentionOk, replyOk] of supportMatrix) {
      const mres = await greetTo(platform, 'mention', { ownerId, handle: 'x', body: 'hi' });
      const rres = await greetTo(platform, 'reply', { ownerId, postId: 'p', body: 'hi' });
      check(`${platform} mention supported=${mentionOk}`, (mres.error !== 'unsupported') === mentionOk, mres);
      check(`${platform} reply supported=${replyOk}`, (rres.error !== 'unsupported') === replyOk, rres);
    }

    console.log(failures === 0 ? '\nPASS — greeting-node checks green (0 real posts, 0 LLM spend)' : `\nFAIL — ${failures} check(s) failed`);
  } finally {
    await prisma.externalActionAuditLog.deleteMany({ where: { ownerId } }).catch(() => {});
  }
  process.exit(failures === 0 ? 0 : 1);
}

await main();
