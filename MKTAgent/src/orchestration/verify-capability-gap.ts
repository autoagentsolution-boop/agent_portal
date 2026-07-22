// Verify the capability-gap path (P1b Phase 02): a capability Atria does NOT have is logged as demand
// (extends RoadmapDemand, not a new table), deduped per capability, surfaced with its drop-in spec — and
// the brain's flag_capability_gap tool records it + returns an honest reply signal (NO workflow proposal).
// One throwaway tenant, cleaned up. No LLM spend (the tool dispatch does not call Gemini).
//   npx tsx src/orchestration/verify-capability-gap.ts
import { prisma } from '../db/client.ts';
import { recordCapabilityGap, wasRequested, listDemand } from '../db/repos/roadmap-demand-repo.ts';
import { dispatchTool, type ToolContext } from './atria/atria-tools.ts';

let failed = 0;
const ok = (cond: boolean, label: string): void => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failed++;
};

const baseCtx = (ownerId: string, message: string): ToolContext => ({
  ownerId, message, memoryContext: null, instructions: null, sessionId: null, priorGoal: null,
  existingRunId: null, searched: [], proposal: null, executeRunId: null, scheduleProposal: null, resolvedLead: null, messageLanguage: null,
});

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `cap-gap-${Date.now()}@test.local`, defaultLanguage: 'vi' } });
  try {
    console.log('Repo (recordCapabilityGap / wasRequested / listDemand)');
    const spec = { produces: 'translated_text', requires: ['source_text', 'target_language'], suggestedGate: 'none', exampleTask: 'translate this PDF to French', whatItWouldDo: 'Translate documents between languages' };
    const first = await recordCapabilityGap(user.id, 'translate', 'user asked to translate a document', spec);
    ok(first === true, 'first request is logged');
    const dup = await recordCapabilityGap(user.id, 'translate', 'asked again', spec);
    ok(dup === false, 'duplicate request is deduped (not logged twice)');
    ok(await wasRequested(user.id, 'translate'), 'wasRequested true after logging');
    ok(!(await wasRequested(user.id, 'transcribe-audio')), 'wasRequested false for an unlogged capability');

    const rows = await listDemand(user.id);
    ok(rows.length === 1, 'exactly one demand row (deduped)');
    const row = rows[0]!;
    ok(row.action === 'requested', "row action is 'requested'");
    ok(row.agentId === 'translate', 'row capability id preserved');
    const persisted = row.spec as { produces?: string; requires?: string[] } | null;
    ok(persisted?.produces === 'translated_text', 'spec.produces persisted');
    ok(Array.isArray(persisted?.requires) && persisted!.requires!.length === 2, 'spec.requires persisted');

    console.log('Brain tool (flag_capability_gap dispatch — no Gemini, no proposal)');
    const ctx = baseCtx(user.id, 'Please transcribe this audio file to text');
    const res = (await dispatchTool('flag_capability_gap', {
      capability: 'transcribe-audio', what_it_would_do: 'Turn speech audio into text', produces: 'transcript',
      requires: ['audio_file'], example_task: 'transcribe this audio file',
    }, ctx)) as { logged?: boolean; note?: string };
    ok(res.logged === true, 'dispatch logs a NEW capability');
    ok(typeof res.note === 'string' && /honest|flagged|cannot|can't/i.test(res.note), 'dispatch returns an honest-reply signal');
    ok(ctx.proposal === null, 'gap does NOT set a workflow proposal (reply-only turn)');
    ok(await wasRequested(user.id, 'transcribe-audio'), 'dispatch persisted the transcribe-audio gap');

    const dupCtx = baseCtx(user.id, 'transcribe again');
    const dupRes = (await dispatchTool('flag_capability_gap', { capability: 'transcribe-audio' }, dupCtx)) as { logged?: boolean };
    ok(dupRes.logged === false, 'dispatch dedups a repeat capability (logged:false, still honest)');

    const finalRows = await listDemand(user.id);
    ok(finalRows.length === 2, 'two distinct capabilities logged total (translate + transcribe-audio)');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }

  if (failed) { console.error(`\nFAIL — ${failed} capability-gap check(s) failed.`); process.exit(1); }
  console.log('\nPASS — capability-gap checks green (0 LLM spend).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
