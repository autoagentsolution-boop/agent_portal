// Atria v2 P2-2b (IG extension) verification. Pure/stubbed: IG media insights parse (reach +
// total_interactions groups, independent), sum across posts, degrade-to-null, TTL cache; plus the
// mergeInsights helper that combines FB + IG per-field null-aware (a field is null only when NEITHER
// platform measured it). No DB / no real Graph call.
import { fetchIgMediaInsights, sumIgInsights } from '../analytics/ig-insights.ts';
import { mergeInsights, emptySum, type InsightsSum } from '../analytics/insights-types.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const reachEnv = (reach: number) => ({ ok: true, json: async () => ({ data: [{ name: 'reach', values: [{ value: reach }] }] }) });
const engageEnv = (n: number) => ({ ok: true, json: async () => ({ data: [{ name: 'total_interactions', values: [{ value: n }] }] }) });
const errEnv = { ok: false, json: async () => ({ error: { message: '(#100) invalid metric' } }) };

async function main(): Promise<void> {
  // ── Parse: both groups OK ────────────────────────────────────────────────────────────────────
  const full = ((url: string) => Promise.resolve(/metric=reach/.test(url) ? reachEnv(500) : engageEnv(42))) as unknown as typeof fetch;
  const a = await fetchIgMediaInsights('t', 'm1', full, 1000);
  check('ig parse: reach + engaged', a.reach === 500 && a.engaged === 42, a);

  // ── Cache: no re-fetch within TTL ────────────────────────────────────────────────────────────
  let calls = 0;
  const counting = ((url: string) => { calls++; return Promise.resolve(/metric=reach/.test(url) ? reachEnv(1) : engageEnv(1)); }) as unknown as typeof fetch;
  await fetchIgMediaInsights('t', 'mc', counting, 2000);
  const first = calls;
  await fetchIgMediaInsights('t', 'mc', counting, 2000 + 60_000);
  check('ig cache: 2nd read no re-fetch', calls === first, { calls, first });

  // ── reach withheld, engage OK → reach null, engaged measured ─────────────────────────────────
  const partial = ((url: string) => Promise.resolve(/metric=reach/.test(url) ? errEnv : engageEnv(7))) as unknown as typeof fetch;
  const p = await fetchIgMediaInsights('t', 'mp', partial, 3000);
  check('ig partial: reach null, engaged 7', p.reach === null && p.engaged === 7, p);

  // ── sum over 2 media; impressions always null for IG ─────────────────────────────────────────
  const map: Record<string, [number, number]> = { a: [500, 40], b: [300, 20] };
  const many = ((url: string) => {
    const id = url.split('/insights')[0]!.split('/').pop()!;
    const [reach, eng] = map[id] ?? [0, 0];
    return Promise.resolve(/metric=reach/.test(url) ? reachEnv(reach) : engageEnv(eng));
  }) as unknown as typeof fetch;
  const sum = await sumIgInsights('o', ['a', 'b'], { token: 't', fetchFn: many, now: 4000 });
  check('ig sum: reach 500+300', sum.measuredReach === 800, sum);
  check('ig sum: engaged 40+20', sum.measuredEngaged === 60, sum);
  check('ig sum: impressions null', sum.measuredImpressions === null, sum);
  check('ig sum: platforms=[instagram]', sum.platforms.join() === 'instagram', sum.platforms);

  // ── no ids / no token → empty ────────────────────────────────────────────────────────────────
  check('ig empty: no ids', (await sumIgInsights('o', [], { token: 't', fetchFn: many, now: 5000 })).measuredReach === null);
  check('ig empty: no token', (await sumIgInsights('o', ['z'], { token: null, fetchFn: many, now: 5100 })).measuredReach === null);

  // ── mergeInsights: FB + IG per-field null-aware ──────────────────────────────────────────────
  const fb: InsightsSum = { measuredReach: null, measuredImpressions: 1000, measuredEngaged: 5, postsMeasured: 6, platforms: ['facebook'] };
  const ig: InsightsSum = { measuredReach: 800, measuredImpressions: null, measuredEngaged: 60, postsMeasured: 2, platforms: ['instagram'] };
  const m = mergeInsights([fb, ig]);
  check('merge: reach = IG only (FB null)', m.measuredReach === 800, m);
  check('merge: impressions = FB only (IG null)', m.measuredImpressions === 1000, m);
  check('merge: engaged summed (5+60)', m.measuredEngaged === 65, m);
  check('merge: postsMeasured 6+2', m.postsMeasured === 8, m);
  check('merge: platforms union', m.platforms.join() === 'facebook,instagram', m.platforms);
  const bothNull = mergeInsights([emptySum(), emptySum()]);
  check('merge: both empty → all null', bothNull.measuredReach === null && bothNull.measuredEngaged === null && bothNull.postsMeasured === 0, bothNull);
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — ig insights + merge green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
