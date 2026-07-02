// HTTP smoke (item 2) — a follow-up message on a SAVED flow (kind=template) that asks to
// create a campaign must NOT fork a new flow: POST /runs returns the SAME template run id
// + campaignIntent=true (the panel then binds a campaign to this flow). Live against :7100.
// Seeds a template directly in the DB (no Gemini), then drives the HTTP branch. Self-cleans.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { createRun, createNodes, nameRun } from '../db/repos/workflow-run-repo.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const call = async (method: string, path: string, token: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body: json };
};

async function main(): Promise<void> {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`Server not reachable at ${BASE} — start it first. ${String(e)}`);
    process.exit(2);
  }

  const user = await prisma.user.create({ data: { email: `reuse-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const token = signSession({ sub: user.id, email: user.email });

  try {
    // Seed: plan → run → save (freeze to template) on a chat session.
    const goal = analyzeDeterministic('Build a full branding campaign for our AI automation product on facebook and instagram with an infographic');
    const planned = planWorkflow(goal);
    if (!planned.ok) { check('planner ok', false, planned); return; }
    const session = await prisma.agentChatSession.create({ data: { ownerId: user.id, title: 'Reuse test' } });
    const draft = await createRun({ ownerId: user.id, chatSessionId: session.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(draft.id, user.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    const template = await nameRun(draft.id, user.id, 'AgentAgency');
    check('seed → template', template?.kind === 'template', template?.kind);

    // Follow-up on the SAVED flow's chat: "create a campaign".
    const followUp = await call('POST', '/orchestration/runs', token, {
      chatSessionId: session.id,
      message: 'Let make a first campaign "Abstract User". First post "Do you tired of Manual work?"',
    });
    check('201 on follow-up', followUp.status === 201, followUp.status);
    check('NO fork — same run id returned', followUp.body?.data?.id === draft.id, { got: followUp.body?.data?.id, expected: draft.id });
    check('run stays template (not re-planned)', followUp.body?.data?.kind === 'template', followUp.body?.data?.kind);
    check('campaignIntent flag set', followUp.body?.data?.campaignIntent === true, followUp.body?.data?.campaignIntent);
    check('createdCampaignId returned', typeof followUp.body?.data?.createdCampaignId === 'string', followUp.body?.data?.createdCampaignId);
    check('createdPostId returned (post title given)', typeof followUp.body?.data?.createdPostId === 'string', followUp.body?.data?.createdPostId);
    check('authored assistantMessage present', typeof followUp.body?.data?.assistantMessage === 'string' && followUp.body.data.assistantMessage.length > 1, followUp.body?.data?.assistantMessage);

    // Option A: the campaign ACTUALLY exists, bound to THIS flow, with its post.
    const createdCampaignId = followUp.body?.data?.createdCampaignId;
    const campaign = createdCampaignId ? await prisma.campaign.findFirst({ where: { id: createdCampaignId, ownerId: user.id } }) : null;
    check('campaign persisted', Boolean(campaign), createdCampaignId);
    check('campaign bound to the flow (flowId=template)', campaign?.flowId === draft.id, { flowId: campaign?.flowId, expected: draft.id });
    check('campaign named from request', campaign?.product === 'Abstract User', campaign?.product);
    check('campaign inherited platforms (FB+IG)',
      Array.isArray(campaign?.platforms) && campaign!.platforms.includes('facebook') && campaign!.platforms.includes('instagram'), campaign?.platforms);
    const posts = createdCampaignId ? await prisma.post.findMany({ where: { campaignId: createdCampaignId } }) : [];
    check('one post created under campaign', posts.length === 1, posts.length);
    check('post has an instance run (cloned DAG)', Boolean(posts[0]?.runId), posts[0]?.runId);

    // The original saved flow is still the ONLY template (no fork). Clone added 1 instance
    // run for the post, so total runs = template + 1 instance = 2 (not a 2nd template).
    const templateCount = await prisma.workflowRun.count({ where: { ownerId: user.id, kind: 'template' } });
    check('still exactly 1 template (no fork)', templateCount === 1, templateCount);

    // Platform override: a create message naming ONE platform must win over the FB+IG
    // template (bug: post came out FB+IG despite "chỉ facebook"). Uses the same saved flow.
    const fbOnly = await call('POST', '/orchestration/runs', token, {
      chatSessionId: session.id,
      message: 'tạo campaign "FB Only", post "Học AI ngay" chỉ đẩy lên facebook thôi',
    });
    const fbCampaignId = fbOnly.body?.data?.createdCampaignId;
    const fbCampaign = fbCampaignId ? await prisma.campaign.findFirst({ where: { id: fbCampaignId } }) : null;
    const fbPosts = fbCampaignId ? await prisma.post.findMany({ where: { campaignId: fbCampaignId } }) : [];
    check('override: campaign platforms = FB only',
      Array.isArray(fbCampaign?.platforms) && fbCampaign!.platforms.length === 1 && fbCampaign!.platforms[0] === 'facebook', fbCampaign?.platforms);
    check('override: post platforms = FB only',
      fbPosts.length === 1 && Array.isArray(fbPosts[0]?.platforms) && fbPosts[0]!.platforms.length === 1 && fbPosts[0]!.platforms[0] === 'facebook', fbPosts[0]?.platforms);

    // Control: a "plan a different flow" message on the same saved chat SHOULD fork a new run.
    const newFlow = await call('POST', '/orchestration/runs', token, {
      chatSessionId: session.id,
      message: 'Now build a separate video-only flow for a different product on linkedin',
    });
    check('control: new-flow request forks a run', newFlow.body?.data?.id !== draft.id, newFlow.body?.data?.id);

    // Refine-in-place regression (was broken by the getLatestRunWithNodesForChat kind
    // filter): a DRAFT run (kind='instance' default, templateId=null) must be found so a
    // follow-up REFINES it (same run id, platforms preserved) rather than re-planning fresh
    // and re-asking everything. New chat so the template above doesn't interfere.
    const chat2 = await call('POST', '/orchestration/runs', token, {
      message: 'Marketing our AI automation product on facebook, instagram, threads, linkedin and x for businesses',
    });
    const draft2Id = chat2.body?.data?.id;
    const chat2Session = chat2.body?.data?.chatSessionId;
    const platforms1 = chat2.body?.data?.goal?.platforms ?? [];
    const refine = await call('POST', '/orchestration/runs', token, {
      chatSessionId: chat2Session,
      message: 'also add an infographic and a storyboard to showcase the workflow',
    });
    check('refine stays on the SAME draft run (no re-plan)', refine.body?.data?.id === draft2Id, { got: refine.body?.data?.id, expected: draft2Id });
    const platforms2 = refine.body?.data?.goal?.platforms ?? [];
    check('refine PRESERVES platforms (no context loss)', platforms2.length === platforms1.length && platforms1.length >= 5, { before: platforms1, after: platforms2 });
    check('refine did NOT re-ask required questions', !(refine.body?.data?.questions ?? []).some((q: any) => q.required), refine.body?.data?.questions);

    console.log(failures === 0 ? '\nPASS — saved-flow reuse (no fork) green' : `\nFAIL — ${failures} check(s)`);
  } finally {
    await prisma.post.deleteMany({ where: { ownerId: user.id } });
    await prisma.workflowRun.deleteMany({ where: { ownerId: user.id } });
    await prisma.agentChatMessage.deleteMany({ where: { session: { ownerId: user.id } } });
    await prisma.agentChatSession.deleteMany({ where: { ownerId: user.id } });
    await prisma.campaign.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
