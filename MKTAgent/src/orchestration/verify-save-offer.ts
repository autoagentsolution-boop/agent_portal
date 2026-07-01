// P6 verification — Master Agent creates & sets up campaigns/posts (DRY, no real posts).
// Proves: (1) the deterministic save-offer sentence is well-formed + mentions the flow
// name; (2) recordSaveOffer persists an agent turn on the run's chat session and bumps
// the session; (3) the "set up first campaign" path creates a Campaign linked to the
// flow (Campaign.flowId = runId); (4) "flows without strategy" = saved runs with no
// campaign attached. No Gemini/image spend — the offer author degrades to its
// deterministic fallback when GEMINI_API_KEY is unset in the verify env.
import { prisma } from '../db/client.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, nameRun } from '../db/repos/workflow-run-repo.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { recordSaveOffer } from '../api/orchestration-chat.ts';
import { deterministicOffer } from './master/save-offer-author.ts';
import { goalSpec } from './schemas/goal-spec.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `so-${Date.now()}@test.local` } });
  try {
    // Deterministic offer sentence (LLM-free path) — mentions the flow name, no publish claim.
    const det = deterministicOffer({ flowName: 'AI Course', product: 'AI Course', language: 'en' });
    check('offer mentions flow name', det.includes('AI Course'), det);
    check('offer makes no publish claim', !/published/i.test(det), det);

    const goal = analyzeDeterministic('Full branding campaign about our AI automation course, publish to facebook');
    const planned = planWorkflow(goal);
    if (!planned.ok) throw new Error(`plan failed: ${planned.error}`);

    const session = await prisma.agentChatSession.create({ data: { ownerId: user.id, title: 'AI Course' } });
    const run = await createRun({ ownerId: user.id, chatSessionId: session.id, goal, plan: planned.plan, status: 'planned' });

    // Save (name) the run, then record the offer turn — mirrors POST /runs/:id/save.
    const named = await nameRun(run.id, user.id, 'AI Course campaign');
    check('run named (saved)', named?.name === 'AI Course campaign', named?.name);

    const before = await prisma.agentChatMessage.count({ where: { sessionId: session.id } });
    const offer = await recordSaveOffer(session.id, 'AI Course campaign', goalSpec.parse(run.goal));
    const after = await prisma.agentChatMessage.count({ where: { sessionId: session.id } });
    check('offer persisted as one agent turn', after === before + 1, { before, after });
    check('offer text non-empty', offer.trim().length > 0, offer);
    const lastMsg = await prisma.agentChatMessage.findFirst({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' } });
    check('persisted turn is role=agent', lastMsg?.role === 'agent' && lastMsg.content === offer, lastMsg?.role);

    // "Flows without strategy" BEFORE any campaign — this saved run has none.
    const flowsBefore = await prisma.workflowRun.findMany({ where: { ownerId: user.id, name: { not: null } }, select: { id: true } });
    const campaignsBefore = await prisma.campaign.findMany({ where: { ownerId: user.id }, select: { flowId: true } });
    const strategizedBefore = new Set(campaignsBefore.map((c) => c.flowId).filter(Boolean));
    check('flow has no strategy yet', flowsBefore.every((f) => !strategizedBefore.has(f.id)), { flowsBefore, strategizedBefore: [...strategizedBefore] });

    // "Set up first campaign" — create a Campaign linked to the flow (Campaign.flowId = runId).
    const campaign = await createCampaign({ ownerId: user.id, product: 'AI Course campaign', flowId: run.id });
    check('campaign linked to flow', campaign.flowId === run.id, campaign.flowId);

    // Now the flow IS strategized — drops out of the hint list.
    const campaignsAfter = await prisma.campaign.findMany({ where: { ownerId: user.id }, select: { flowId: true } });
    const strategizedAfter = new Set(campaignsAfter.map((c) => c.flowId).filter(Boolean));
    check('flow now counted as strategized', strategizedAfter.has(run.id), [...strategizedAfter]);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(failures === 0 ? '\nverify-save-offer: ALL GREEN' : `\nverify-save-offer: ${failures} FAILURE(S)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
