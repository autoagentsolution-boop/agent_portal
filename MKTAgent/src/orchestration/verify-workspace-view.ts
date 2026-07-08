// Atria v2 P0 verification — the Workspace view-model. Proves a Campaign reframes into a Workspace
// with correct per-agent rollup (tokens/cost/credits + status breakdown) sourced from real node-run
// rows, that workspace totals equal the sum of agent cards, and that reads are tenant-isolated.
// Throwaway tenants; no engine change touched. Run: tsx src/orchestration/verify-workspace-view.ts
import { prisma } from '../db/client.ts';
import { materializeCalendar } from './master/campaign-materializer.ts';
import { listWorkspaces, getWorkspace } from './master/workspace-view.ts';
import { creditsFromTokens } from '../cost/credits.ts';
import type { CalendarSlot } from './schemas/artifact-schemas.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const slot = (index: number, format: CalendarSlot['format'], dayOffset: number): CalendarSlot =>
  ({ index, pillar: `P${index}`, angle: `Angle ${index}`, format, platforms: ['facebook'], hook: 'h', rationale: 'r', dayOffset });

async function main(): Promise<void> {
  const now = new Date('2026-07-08T00:00:00Z');
  const user = await prisma.user.create({ data: { email: `ws-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const other = await prisma.user.create({ data: { email: `ws-other-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: {
      ownerId: user.id, product: 'AI automation platform', angle: 'proof-first', brandContext: 'Automates ops.',
      platforms: ['facebook'], postingWindow: '09:00-11:00', timezone: 'Asia/Bangkok', language: 'en',
    } });
    const mat = await materializeCalendar(campaign.id, user.id, [slot(0, 'image', 0), slot(1, 'video', 2)], { now });
    check('setup: 2 posts materialized', mat?.posts.length === 2, mat?.posts.length);

    // Inject real per-node cost/status so the rollup has data to aggregate. Take the first run's nodes:
    // mark one agent completed-with-cost, another running, a third failed.
    const runId = mat!.posts[0]!.runId;
    const nodes = await prisma.workflowNodeRun.findMany({ where: { runId }, orderBy: { nodeId: 'asc' } });
    check('setup: run has >= 3 nodes', nodes.length >= 3, nodes.length);
    await prisma.workflowNodeRun.update({ where: { id: nodes[0]!.id }, data: { status: 'completed', promptTokens: 400, outputTokens: 600, totalTokens: 1000, costUsd: 0.02 } });
    await prisma.workflowNodeRun.update({ where: { id: nodes[1]!.id }, data: { status: 'running' } });
    await prisma.workflowNodeRun.update({ where: { id: nodes[2]!.id }, data: { status: 'failed', totalTokens: 200, costUsd: 0.004 } });
    const spentAgentId = nodes[0]!.agentId;

    // ── listWorkspaces ─────────────────────────────────────────────────────────────────────────
    const list = await listWorkspaces(user.id);
    const card = list.find((w) => w.campaignId === campaign.id);
    check('list: campaign surfaces as a workspace', Boolean(card), list.map((w) => w.campaignId));
    check('list: name falls back to product', card?.name === 'AI automation platform', card?.name);
    check('list: postCount = 2', card?.postCount === 2, card?.postCount);
    check('list: costUsd > 0 (real node cost)', (card?.costUsd ?? 0) > 0, card?.costUsd);
    check('list: credits > 0', (card?.credits ?? 0) > 0, card?.credits);

    // ── getWorkspace detail ──────────────────────────────────────────────────────────────────
    const ws = await getWorkspace(campaign.id, user.id);
    check('detail: found', Boolean(ws));
    check('detail: postCount = 2', ws?.postCount === 2, ws?.postCount);
    check('detail: has agent cards', (ws?.agents.length ?? 0) > 0, ws?.agents.length);
    const spent = ws!.agents.find((a) => a.agentId === spentAgentId)!;
    check('detail: spent agent has display name', Boolean(spent?.name) && spent.name !== spent.agentId, spent?.name);
    check('detail: spent agent has emoji', Boolean(spent?.emoji), spent?.emoji);
    check('detail: spent agent tokens = 1000', spent?.totalTokens === 1000, spent?.totalTokens);
    check('detail: spent agent credits = creditsFromTokens(1000)', spent?.credits === creditsFromTokens(1000), spent?.credits);
    check('detail: spent agent completed count = 1', spent?.completed === 1, spent?.completed);

    // Workspace total == sum of agent cards (dashboard invariant).
    const sumTokens = ws!.agents.reduce((s, a) => s + a.totalTokens, 0);
    const sumUsd = ws!.agents.reduce((s, a) => s + a.costUsd, 0);
    check('detail: totalTokens == sum(agent tokens)', ws!.totalTokens === sumTokens, { total: ws!.totalTokens, sum: sumTokens });
    check('detail: costUsd == sum(agent costUsd)', Math.abs(ws!.costUsd - sumUsd) < 1e-9, { total: ws!.costUsd, sum: sumUsd });
    // Status breakdown: exactly one running + one failed node across the aggregated agents.
    const running = ws!.agents.reduce((s, a) => s + a.running, 0);
    const failed = ws!.agents.reduce((s, a) => s + a.failed, 0);
    check('detail: exactly 1 running node aggregated', running === 1, running);
    check('detail: exactly 1 failed node aggregated', failed === 1, failed);

    // ── Tenant isolation ─────────────────────────────────────────────────────────────────────
    check('isolation: cross-tenant getWorkspace → null', (await getWorkspace(campaign.id, other.id)) === null);
    const otherList = await listWorkspaces(other.id);
    check('isolation: other tenant list excludes campaign', !otherList.some((w) => w.campaignId === campaign.id));
    check('isolation: bogus id → null', (await getWorkspace('00000000-0000-0000-0000-000000000000', user.id)) === null);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: other.id } });
    console.log('cleanup: throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — workspace view-model checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
