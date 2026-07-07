// Phase 07 verification — impact / value report. Proves the metrics aggregate REAL numbers (cost
// from the ledger, published posts, platforms, media pieces, leads), reconcile with the ledger the
// Usage page reads, and the value model derives a correctly-labeled saved-vs-agency estimate from
// the configurable baseline. One throwaway tenant with seeded ledger + posts + leads.
import { prisma } from '../db/client.ts';
import { env } from '../config/env.ts';
import { recordLlmUsage, recordMediaCost } from '../cost/llm-usage.ts';
import { metricsForCampaign, metricsForPeriod } from './impact-metrics.ts';
import { estimateValue, buildImpactReport } from './value-model.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `impact-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: { ownerId: user.id, product: 'AI CRM', platforms: ['facebook'] } });
    const goal = { goal: 'marketing_content', outputs: {}, platforms: [], slots: {} };
    const run1 = await prisma.workflowRun.create({ data: { ownerId: user.id, goal, status: 'completed' } });
    const run2 = await prisma.workflowRun.create({ data: { ownerId: user.id, goal, status: 'completed' } });
    const post1 = await prisma.post.create({ data: { campaignId: campaign.id, ownerId: user.id, status: 'posted', platforms: ['facebook'], runId: run1.id } });
    const post2 = await prisma.post.create({ data: { campaignId: campaign.id, ownerId: user.id, status: 'partial', platforms: ['instagram'], runId: run2.id } });
    await prisma.post.create({ data: { campaignId: campaign.id, ownerId: user.id, status: 'brief', platforms: ['facebook'], runId: null } });

    // Ledger: one token row + two media rows (infographic + video), matched by runId/refId.
    await recordLlmUsage({ ownerId: user.id, surface: 'orchestration', model: env.GEMINI_MODEL, usage: { promptTokens: 2000, outputTokens: 1000, thoughtTokens: 0, cachedTokens: 0 }, runId: run1.id, refId: post1.id });
    await recordMediaCost({ ownerId: user.id, surface: 'infographic', model: 'gemini-2.5-flash-image', costUsd: 0.04, runId: run1.id, refId: post1.id });
    await recordMediaCost({ ownerId: user.id, surface: 'video', model: 'veo', costUsd: 0.40, runId: run2.id, refId: post2.id });

    // Leads attributed to the campaign by product.
    for (let i = 0; i < 2; i++) {
      await prisma.lead.create({ data: { ownerId: user.id, source: 'comment', sourceProduct: 'AI CRM', email: `lead-${i}@x.test` } });
    }

    const metrics = await metricsForCampaign(campaign.id, user.id);
    check('metrics: 2 published posts (posted + partial)', metrics.postsPublished === 2, metrics.postsPublished);
    check('metrics: 3 total posts', metrics.postsTotal === 3, metrics.postsTotal);
    check('metrics: platforms = facebook + instagram', metrics.platforms.sort().join(',') === 'facebook,instagram', metrics.platforms);
    check('metrics: 2 media pieces', metrics.mediaPieces === 2, metrics.mediaPieces);
    check('metrics: leads captured = 2', metrics.leadsCaptured === 2, metrics.leadsCaptured);
    check('metrics: usdSpent > 0', metrics.usdSpent > 0, metrics.usdSpent);
    check('metrics: creditsSpent > 0', metrics.creditsSpent > 0, metrics.creditsSpent);

    // Reconcile with the ledger the Usage page reads (same mkt_llm_usage rows for this campaign).
    const ledger = await prisma.llmUsage.aggregate({ where: { ownerId: user.id, OR: [{ refId: { in: [post1.id, post2.id] } }, { runId: { in: [run1.id, run2.id] } }] }, _sum: { costUsd: true } });
    check('metrics: usdSpent reconciles with ledger', Math.abs(metrics.usdSpent - (ledger._sum.costUsd ?? 0)) < 1e-9, { m: metrics.usdSpent, l: ledger._sum.costUsd });
    check('metrics: media USD present (≥ $0.44)', metrics.usdSpent >= 0.44, metrics.usdSpent);

    // Value model — labeled estimate from the configured baseline (defaults: 2h/post, 8h/day, $500/day).
    const value = estimateValue(metrics);
    const expectedBaseline = round2((2 * env.IMPACT_HOURS_PER_POST / env.IMPACT_WORK_HOURS_PER_DAY) * env.IMPACT_AGENCY_DAY_RATE_USD);
    check('value: baselineUsd from configured constants', value.baselineUsd === expectedBaseline, { got: value.baselineUsd, exp: expectedBaseline });
    check('value: marked as estimate', value.estimated === true);
    check('value: savedUsd = baseline − spent (≥0)', value.savedUsd === round2(Math.max(0, value.baselineUsd - metrics.usdSpent)), value);
    check('value: estimatedReach = posts × reachPerPost', value.estimatedReach === 2 * env.IMPACT_REACH_PER_POST, value.estimatedReach);
    check('value: assumptions exposed (auditable)', value.assumptions.agencyDayRateUsd === env.IMPACT_AGENCY_DAY_RATE_USD);

    const report = buildImpactReport('campaign', metrics);
    check('report: headline shows spend vs agency + posts', /vs an estimated ~\$/.test(report.headline) && /2 posts/.test(report.headline), report.headline);

    // Period report includes the same activity (since epoch → everything).
    const period = await metricsForPeriod(user.id, new Date(0));
    check('period: sees the 2 published posts', period.postsPublished === 2, period.postsPublished);
    check('period: usdSpent ≥ campaign usdSpent', period.usdSpent >= metrics.usdSpent - 1e-9, { p: period.usdSpent, c: metrics.usdSpent });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — impact report checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
