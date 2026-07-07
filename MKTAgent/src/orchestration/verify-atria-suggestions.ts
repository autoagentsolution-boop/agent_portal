// Phase 06 verification — proactive suggestions. Proves the signal reader derives the right signals
// from existing data, the deterministic engine emits the RIGHT suggestion (with a shown rationale +
// prefill) for each situation, no signal → no noise, and the roadmap demand log dedups pitches.
// Pure rule/signal checks + one DB smoke (readSignals + demand log). Throwaway tenant.
import { prisma } from '../db/client.ts';
import { deriveSignals, readSignals, type SignalInput } from './atria/signal-reader.ts';
import { suggestFor } from './atria/atria-suggestions.ts';
import { logRoadmapDemand, wasPitched } from '../db/repos/roadmap-demand-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const kinds = (s: ReturnType<typeof suggestFor>): string[] => s.map((x) => x.kind);

async function main(): Promise<void> {
  // ── R1: 3 one-off posts, same product, no active campaign → plan_campaign ─────────────────
  const oneOff: SignalInput = {
    campaigns: [
      { id: 'c1', product: 'AI CRM', postCount: 1 },
      { id: 'c2', product: 'AI CRM', postCount: 1 },
      { id: 'c3', product: 'AI CRM', postCount: 1 },
    ],
    posts: [
      { campaignId: 'c1', status: 'posted', copyEdited: false },
      { campaignId: 'c2', status: 'posted', copyEdited: false },
      { campaignId: 'c3', status: 'draft', copyEdited: false },
    ],
    leadCount: 0,
  };
  const s1 = deriveSignals(oneOff);
  check('signal: top one-off product = AI CRM ×3', s1.oneOffTopProduct === 'AI CRM' && s1.oneOffTopProductCount === 3, s1);
  const sug1 = suggestFor(s1);
  check('R1: plan_campaign suggested', kinds(sug1).includes('plan_campaign'), kinds(sug1));
  const plan = sug1.find((x) => x.kind === 'plan_campaign')!;
  check('R1: prefills the product + intent', plan.prefill.product === 'AI CRM' && /AI CRM/.test(plan.prefill.intent ?? ''), plan.prefill);
  check('R1: rationale shows the count (trust story)', /3 one-off posts/.test(plan.rationale), plan.rationale);

  // R1 must NOT fire when an active (multi-post) campaign for that product already exists.
  const withActive = deriveSignals({ ...oneOff, campaigns: [...oneOff.campaigns, { id: 'c4', product: 'AI CRM', postCount: 8 }] });
  check('R1: suppressed when product already has a campaign', !kinds(suggestFor(withActive)).includes('plan_campaign'), suggestFor(withActive));

  // ── R3: many leads, no email capability → pitch Email roadmap ─────────────────────────────
  const leadsSig = deriveSignals({ campaigns: [], posts: [], leadCount: 12 });
  const sugLeads = suggestFor(leadsSig);
  check('R3: roadmap_email pitched on lead volume', kinds(sugLeads).includes('roadmap_email'), kinds(sugLeads));
  check('R3: pitch prefills the email roadmap agent', sugLeads.find((x) => x.kind === 'roadmap_email')?.prefill.roadmapAgentId === 'email');

  // ── R4: high edit ratio → pitch Memory ────────────────────────────────────────────────────
  const editSig = deriveSignals({
    campaigns: [{ id: 'c1', product: 'X', postCount: 4 }],
    posts: Array.from({ length: 4 }, (_, i) => ({ campaignId: 'c1', status: 'posted', copyEdited: i < 3 })),
    leadCount: 0,
  });
  check('signal: edit ratio 3/4', Math.abs(editSig.editedPostRatio - 0.75) < 1e-9 && editSig.editedPostCount === 3, editSig);
  check('R4: roadmap_memory pitched on high edit ratio', kinds(suggestFor(editSig)).includes('roadmap_memory'));

  // ── R2: a completed multi-post campaign → repeat_winner ───────────────────────────────────
  const doneSig = deriveSignals({
    campaigns: [{ id: 'c1', product: 'X', postCount: 3 }],
    posts: [
      { campaignId: 'c1', status: 'posted', copyEdited: false },
      { campaignId: 'c1', status: 'posted', copyEdited: false },
      { campaignId: 'c1', status: 'partial', copyEdited: false },
    ],
    leadCount: 0,
  });
  check('signal: 1 completed campaign', doneSig.completedCampaignCount === 1, doneSig);
  check('R2: repeat_winner suggested', kinds(suggestFor(doneSig)).includes('repeat_winner'));

  // ── No signal → no noise ──────────────────────────────────────────────────────────────────
  const quiet = deriveSignals({ campaigns: [{ id: 'c1', product: 'X', postCount: 1 }], posts: [{ campaignId: 'c1', status: 'draft', copyEdited: false }], leadCount: 1 });
  check('no signal → empty suggestions', suggestFor(quiet).length === 0, suggestFor(quiet));

  // ── Ranking: plan_campaign outranks roadmap pitches ───────────────────────────────────────
  const rich = deriveSignals({
    campaigns: [
      { id: 'c1', product: 'AI CRM', postCount: 1 }, { id: 'c2', product: 'AI CRM', postCount: 1 }, { id: 'c3', product: 'AI CRM', postCount: 1 },
    ],
    posts: [
      { campaignId: 'c1', status: 'posted', copyEdited: true }, { campaignId: 'c2', status: 'posted', copyEdited: true }, { campaignId: 'c3', status: 'posted', copyEdited: true },
    ],
    leadCount: 20,
  });
  const ranked = suggestFor(rich);
  check('ranking: plan_campaign is first', ranked[0]?.kind === 'plan_campaign', kinds(ranked));

  // ── DB smoke: readSignals + demand log dedup ──────────────────────────────────────────────
  const user = await prisma.user.create({ data: { email: `atria-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    for (let i = 0; i < 3; i++) {
      const c = await prisma.campaign.create({ data: { ownerId: user.id, product: 'AI CRM', platforms: ['facebook'] } });
      await prisma.post.create({ data: { campaignId: c.id, ownerId: user.id, status: 'posted', platforms: ['facebook'] } });
    }
    const dbSignals = await readSignals(user.id);
    check('DB: readSignals sees 3 one-off AI CRM', dbSignals.oneOffTopProduct === 'AI CRM' && dbSignals.oneOffTopProductCount === 3, dbSignals);
    check('DB: readSignals → plan_campaign suggestion', kinds(suggestFor(dbSignals)).includes('plan_campaign'));

    check('demand: not pitched yet', !(await wasPitched(user.id, 'email')));
    await logRoadmapDemand(user.id, 'email', 'pitched', 'roadmap_email');
    check('demand: pitched recorded (dedup source)', await wasPitched(user.id, 'email'));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — atria suggestion checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
