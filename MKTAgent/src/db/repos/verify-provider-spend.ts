// Provider-spend aggregation (super-admin console). What actually needs pinning is the WINDOW
// BOUNDARIES — a row 3 days old must count in 7d/30d but not 24h, and a 40-day-old row must count
// only in lifetime. Off-by-one there silently misreports burn rate, which is the one number this
// panel exists to show.
//
// Asserted as DELTAS against a baseline, not absolutes: the ledger is global (no owner filter) and
// holds real history, so absolute expectations would be wrong the moment anything else runs.
import { prisma } from '../client.ts';
import { getProviderSpend } from './provider-spend-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005; // cent-rounded comparison

const SURFACE = `verify_spend_${Date.now()}`;
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 60 * 60 * 1000);

async function main(): Promise<void> {
  const before = await getProviderSpend();

  // 1h ago → every window. 3d ago → 7d/30d/lifetime. 40d ago → lifetime only.
  await prisma.llmUsage.createMany({
    data: [
      { surface: SURFACE, model: 'verify-model-a', costUsd: 1.5, createdAt: hoursAgo(1) },
      { surface: SURFACE, model: 'verify-model-a', costUsd: 2.25, createdAt: hoursAgo(24 * 3) },
      { surface: SURFACE, model: 'verify-model-b', costUsd: 10, createdAt: hoursAgo(24 * 40) },
    ],
  });

  try {
    const after = await getProviderSpend();
    const d = (k: 'last24h' | 'last7d' | 'last30d' | 'lifetime'): number =>
      after.windows[k].costUsd - before.windows[k].costUsd;
    const dCalls = (k: 'last24h' | 'last7d' | 'last30d' | 'lifetime'): number =>
      after.windows[k].calls - before.windows[k].calls;

    check('last24h counts only the 1h-old row', near(d('last24h'), 1.5) && dCalls('last24h') === 1, d('last24h'));
    check('last7d counts the 1h + 3d rows', near(d('last7d'), 3.75) && dCalls('last7d') === 2, d('last7d'));
    check('last30d counts the 1h + 3d rows, NOT the 40d one', near(d('last30d'), 3.75) && dCalls('last30d') === 2, d('last30d'));
    check('lifetime counts all three', near(d('lifetime'), 13.75) && dCalls('lifetime') === 3, d('lifetime'));

    // 30d slices must agree with the 30d window — the 40d row belongs to neither.
    const slice = after.bySurface.find((s) => s.key === SURFACE);
    check('bySurface (30d) carries the test surface at the 30d total', near(slice?.costUsd ?? -1, 3.75), slice);
    check('bySurface excludes the 40d row from its call count', slice?.calls === 2, slice);
    const modelB = after.byModel.find((m) => m.key === 'verify-model-b');
    check('byModel (30d) omits a model seen only 40d ago', modelB === undefined, modelB);

    check('slices are sorted by cost, biggest first',
      after.bySurface.every((s, i) => i === 0 || after.bySurface[i - 1]!.costUsd >= s.costUsd), after.bySurface.map((s) => s.costUsd));

    // Daily series: 14 days, UTC calendar days, oldest first, and must include today's row.
    check('daily series is oldest-first and ≤ 15 buckets',
      after.daily.length <= 15 && after.daily.every((x, i) => i === 0 || after.daily[i - 1]!.day <= x.day), after.daily.map((x) => x.day));
    const today = new Date().toISOString().slice(0, 10);
    check('daily series includes today (UTC)', after.daily.some((x) => x.day === today), after.daily.map((x) => x.day));

    // The contract of option A: this endpoint never asserts a balance it cannot read.
    check('summary exposes no balance/remaining field', !/"(balance|remaining|runway)"/i.test(JSON.stringify(after)), Object.keys(after));
  } finally {
    await prisma.llmUsage.deleteMany({ where: { surface: SURFACE } });
    console.log('cleanup: test ledger rows removed');
  }

  console.log(failures === 0 ? '\nPASS — provider spend windows + slices green' : `\nFAIL — ${failures} check(s)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
