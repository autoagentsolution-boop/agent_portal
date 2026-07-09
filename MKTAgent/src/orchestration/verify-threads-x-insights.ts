// Atria v2 P2-2b (Threads + X extension) verification. Pure/stubbed: Threads media insights parse
// (views + engage groups, independent, total_value|values shapes), X public_metrics parse (single
// call, impression_count → impressions, engagement summed), sum + degrade-to-null + TTL cache, and
// the 4-way mergeInsights (FB+IG+TH+X) per-field null-aware. No DB / no real API call.
import { fetchThreadsPostInsights, sumThreadsInsights } from '../analytics/threads-insights.ts';
import { fetchXPostInsights, sumXInsights } from '../analytics/x-insights.ts';
import { mergeInsights, emptySum, type InsightsSum } from '../analytics/insights-types.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// ── Threads stubs ──────────────────────────────────────────────────────────────────────────────
const thViews = (n: number) => ({ ok: true, json: async () => ({ data: [{ name: 'views', total_value: { value: n } }] }) });
const thEngage = (l: number, r: number, rp: number, q: number) => ({
  ok: true,
  json: async () => ({ data: [
    { name: 'likes', values: [{ value: l }] }, { name: 'replies', values: [{ value: r }] },
    { name: 'reposts', values: [{ value: rp }] }, { name: 'quotes', values: [{ value: q }] },
  ] }),
});
const thErr = { ok: false, json: async () => ({ error: { message: '(#100) invalid metric' } }) };

// ── X stubs ────────────────────────────────────────────────────────────────────────────────────
const xTweet = (pm: Record<string, number>) => ({ ok: true, json: async () => ({ data: { public_metrics: pm } }) });
const xNoImpr = (pm: Record<string, number>) => ({ ok: true, json: async () => ({ data: { public_metrics: pm } }) });
const xRateLimited = { ok: false, json: async () => ({ title: 'Too Many Requests' }) };

async function main(): Promise<void> {
  // ── Threads parse: both groups OK (views via total_value, engage via values) ─────────────────
  const thFull = ((url: string) => Promise.resolve(/metric=views/.test(url) ? thViews(1200) : thEngage(10, 4, 2, 1))) as unknown as typeof fetch;
  const a = await fetchThreadsPostInsights('t', 'm1', thFull, 1000);
  check('threads parse: impressions 1200, engaged 17', a.impressions === 1200 && a.engaged === 17, a);

  // ── Threads cache: no re-fetch within TTL ────────────────────────────────────────────────────
  let calls = 0;
  const counting = ((url: string) => { calls++; return Promise.resolve(/metric=views/.test(url) ? thViews(1) : thEngage(1, 0, 0, 0)); }) as unknown as typeof fetch;
  await fetchThreadsPostInsights('t', 'mc', counting, 2000);
  const first = calls;
  await fetchThreadsPostInsights('t', 'mc', counting, 2000 + 60_000);
  check('threads cache: 2nd read no re-fetch', calls === first, { calls, first });

  // ── Threads partial: views withheld → impressions null, engaged measured ─────────────────────
  const thPartial = ((url: string) => Promise.resolve(/metric=views/.test(url) ? thErr : thEngage(5, 0, 0, 0))) as unknown as typeof fetch;
  const p = await fetchThreadsPostInsights('t', 'mp', thPartial, 3000);
  check('threads partial: impressions null, engaged 5', p.impressions === null && p.engaged === 5, p);

  // ── Threads sum over 2 media; reach always null ──────────────────────────────────────────────
  const thMap: Record<string, [number, number]> = { a: [1000, 10], b: [500, 5] };
  const thMany = ((url: string) => {
    const id = url.split('/insights')[0]!.split('/').pop()!;
    const [v, e] = thMap[id] ?? [0, 0];
    return Promise.resolve(/metric=views/.test(url) ? thViews(v) : thEngage(e, 0, 0, 0));
  }) as unknown as typeof fetch;
  const thSum = await sumThreadsInsights('o', ['a', 'b'], { token: 't', fetchFn: thMany, now: 4000 });
  check('threads sum: impressions 1000+500', thSum.measuredImpressions === 1500, thSum);
  check('threads sum: engaged 10+5', thSum.measuredEngaged === 15, thSum);
  check('threads sum: reach null', thSum.measuredReach === null, thSum);
  check('threads sum: platforms=[threads]', thSum.platforms.join() === 'threads', thSum.platforms);

  // ── X parse: paid tier (impression_count present) ────────────────────────────────────────────
  const xFull = (() => Promise.resolve(xTweet({ like_count: 20, reply_count: 3, retweet_count: 5, quote_count: 2, impression_count: 3400 }))) as unknown as typeof fetch;
  const x1 = await fetchXPostInsights('t', 'tw1', xFull, 1000);
  check('x parse: impressions 3400, engaged 30', x1.impressions === 3400 && x1.engaged === 30, x1);

  // ── X free tier: impression_count absent → impressions null, engagement still measured ───────
  const xFree = (() => Promise.resolve(xNoImpr({ like_count: 4, reply_count: 1, retweet_count: 0, quote_count: 0 }))) as unknown as typeof fetch;
  const x2 = await fetchXPostInsights('t', 'tw2', xFree, 1000);
  check('x free: impressions null, engaged 5', x2.impressions === null && x2.engaged === 5, x2);

  // ── X rate-limited (429) → both null, no throw ───────────────────────────────────────────────
  const x3 = await fetchXPostInsights('t', 'tw3', (() => Promise.resolve(xRateLimited)) as unknown as typeof fetch, 1000);
  check('x 429: both null, no throw', x3.impressions === null && x3.engaged === null, x3);

  // ── X sum; reach always null ─────────────────────────────────────────────────────────────────
  const xMap: Record<string, Record<string, number>> = { p: { like_count: 10, reply_count: 0, retweet_count: 0, quote_count: 0, impression_count: 900 }, q: { like_count: 5, reply_count: 0, retweet_count: 0, quote_count: 0, impression_count: 100 } };
  const xMany = ((url: string) => { const id = url.split('?')[0]!.split('/').pop()!; return Promise.resolve(xTweet(xMap[id] ?? {})); }) as unknown as typeof fetch;
  const xSum = await sumXInsights('o', ['p', 'q'], { token: 't', fetchFn: xMany, now: 2000 });
  check('x sum: impressions 900+100', xSum.measuredImpressions === 1000, xSum);
  check('x sum: engaged 10+5', xSum.measuredEngaged === 15, xSum);
  check('x sum: reach null', xSum.measuredReach === null, xSum);

  // ── empty / no token ─────────────────────────────────────────────────────────────────────────
  check('threads empty: no ids', (await sumThreadsInsights('o', [], { token: 't', fetchFn: thMany, now: 5000 })).measuredImpressions === null);
  check('x empty: no token', (await sumXInsights('o', ['z'], { token: null, fetchFn: xMany, now: 5100 })).measuredEngaged === null);

  // ── 4-way merge: FB + IG + TH + X per-field null-aware ────────────────────────────────────────
  const fb: InsightsSum = { measuredReach: null, measuredImpressions: 1000, measuredEngaged: 5, postsMeasured: 6, platforms: ['facebook'] };
  const ig: InsightsSum = { measuredReach: 800, measuredImpressions: null, measuredEngaged: 60, postsMeasured: 2, platforms: ['instagram'] };
  const th: InsightsSum = { measuredReach: null, measuredImpressions: 1500, measuredEngaged: 15, postsMeasured: 2, platforms: ['threads'] };
  const x: InsightsSum = { measuredReach: null, measuredImpressions: 1000, measuredEngaged: 15, postsMeasured: 2, platforms: ['x'] };
  const m = mergeInsights([fb, ig, th, x]);
  check('merge: reach = IG only (others null)', m.measuredReach === 800, m);
  check('merge: impressions = FB+TH+X (IG null)', m.measuredImpressions === 3500, m);
  check('merge: engaged = 5+60+15+15', m.measuredEngaged === 95, m);
  check('merge: postsMeasured 6+2+2+2', m.postsMeasured === 12, m);
  check('merge: platforms union', m.platforms.join() === 'facebook,instagram,threads,x', m.platforms);
  const allNull = mergeInsights([emptySum(), emptySum()]);
  check('merge: both empty → all null', allNull.measuredReach === null && allNull.measuredImpressions === null && allNull.postsMeasured === 0, allNull);
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — threads + x insights + 4-way merge green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
