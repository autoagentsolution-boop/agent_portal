// Phase 05 verification — campaign-level autonomy grant. Proves ONE grant flips EVERY materialized
// post's run to 'atria' in a single action, the double-confirm token is scoped to (campaign, owner),
// a non-grantable run (already running) is left human (no autonomy leak), the whole-calendar cost
// estimate + status rollup are correct, and an ungranted campaign stays human. Throwaway tenant.
import { prisma } from '../db/client.ts';
import { materializeCalendar } from './master/campaign-materializer.ts';
import { grantAutonomyForCampaign } from '../db/repos/workflow-run-repo.ts';
import { estimateCampaignCost, campaignStatusRollup } from './master/campaign-grant.ts';
import { issueCampaignGrantToken, verifyCampaignGrantToken } from '../api/autonomy-grant-token.ts';
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
  const user = await prisma.user.create({ data: { email: `grant-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const other = await prisma.user.create({ data: { email: `grant-other-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: {
      ownerId: user.id, product: 'AI automation platform', brandContext: 'Automates ops.', platforms: ['facebook'],
      postingWindow: '09:00-11:00', timezone: 'Asia/Bangkok', language: 'en',
    } });
    const calendar = [slot(0, 'text', 0), slot(1, 'image', 2), slot(2, 'video', 5), slot(3, 'image', 7)];
    const mat = await materializeCalendar(campaign.id, user.id, calendar, { now });
    check('setup: 4 posts materialized', mat?.posts.length === 4, mat?.posts.length);

    // ── Token scoping ─────────────────────────────────────────────────────────────────────────
    const token = issueCampaignGrantToken(campaign.id, user.id);
    check('token: valid for (campaign, owner)', verifyCampaignGrantToken(campaign.id, user.id, token));
    check('token: no token → not confirmed', !verifyCampaignGrantToken(campaign.id, user.id, undefined));
    check('token: wrong campaign id rejected', !verifyCampaignGrantToken('00000000-0000-0000-0000-000000000000', user.id, token));
    check('token: cross-tenant rejected', !verifyCampaignGrantToken(campaign.id, other.id, token));

    // ── Cost estimate (whole calendar) ─────────────────────────────────────────────────────────
    const est = await estimateCampaignCost(campaign.id, user.id);
    check('estimate: covers all 4 posts', est.posts === 4, est.posts);
    check('estimate: costUsd > 0 (video post carries media floor)', est.costUsd > 0, est.costUsd);
    check('estimate: credits > 0', est.credits > 0, est.credits);

    // ── Ungranted safety: runs start human (no autonomy leak) ──────────────────────────────────
    const before = await prisma.workflowRun.findMany({ where: { id: { in: mat!.posts.map((p) => p.runId) } }, select: { approvalMode: true } });
    check('ungranted: all runs start approvalMode=human', before.every((r) => r.approvalMode === 'human'), before);

    const rollupBefore = await campaignStatusRollup(campaign.id, user.id);
    check('rollup: total = 4, all planned pre-grant', rollupBefore.total === 4 && rollupBefore.counts.planned === 4, rollupBefore.counts);

    // ── One post's run is non-grantable (simulate a sibling already running) ───────────────────
    const runningRunId = mat!.posts[0]!.runId;
    await prisma.workflowRun.update({ where: { id: runningRunId }, data: { status: 'running' } });

    // ── The grant: flips every GRANTABLE run in one action ─────────────────────────────────────
    const { granted } = await grantAutonomyForCampaign(campaign.id, user.id, true);
    check('grant: flipped the 3 grantable runs (running one skipped)', granted === 3, granted);
    const after = await prisma.workflowRun.findMany({ where: { id: { in: mat!.posts.map((p) => p.runId) } }, select: { id: true, approvalMode: true, scheduleConfirmed: true, status: true } });
    check('grant: 3 runs now atria + scheduleConfirmed', after.filter((r) => r.approvalMode === 'atria' && r.scheduleConfirmed).length === 3, after);
    const runningRun = after.find((r) => r.id === runningRunId)!;
    check('grant: the running run stayed human (no autonomy leak)', runningRun.approvalMode === 'human', runningRun);

    // ── Cross-tenant grant does nothing ────────────────────────────────────────────────────────
    const crossGrant = await grantAutonomyForCampaign(campaign.id, other.id, true);
    check('grant: cross-tenant grants nothing', crossGrant.granted === 0, crossGrant);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: other.id } });
    console.log('cleanup: throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — campaign grant checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
