// Atria v2 P2-2b verification — FB Insights (two independent metric groups) → Impact. Pure/stubbed:
// proves reach-group and engage-group parse independently, that a WITHHELD reach group still yields
// measured engagement (this is the real small-page case), that N posts sum per-field, that all-error
// degrades each field to null (Impact keeps its estimate, never a false 0), and the TTL cache holds.
import { fetchFbPostInsights, sumFbInsights } from '../analytics/fb-insights.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Build a stubbed Graph responder from a per-metric-group map. url → which group by the metric list.
const reachEnv = (reach: number, impr: number) => ({ ok: true, json: async () => ({ data: [
  { name: 'post_impressions_unique', values: [{ value: reach }] },
  { name: 'post_impressions', values: [{ value: impr }] },
] }) });
const engageEnv = (clicks: number, reactions: Record<string, number>) => ({ ok: true, json: async () => ({ data: [
  { name: 'post_clicks', values: [{ value: clicks }] },
  { name: 'post_reactions_by_type_total', values: [{ value: reactions }] },
] }) });
const errEnv = { ok: false, json: async () => ({ error: { message: '(#100) The value must be a valid insights metric' } }) };

async function main(): Promise<void> {
  // ── Full page: both groups OK ────────────────────────────────────────────────────────────────
  const full = ((url: string) => Promise.resolve(/post_impressions_unique/.test(url) ? reachEnv(800, 1000) : engageEnv(5, { like: 3, love: 2 }))) as unknown as typeof fetch;
  const a = await fetchFbPostInsights('t', 'full', full, 1000);
  check('parse: reach + impressions', a.reach === 800 && a.impressions === 1000, a);
  check('parse: engaged = clicks + reactions (5+5)', a.engaged === 10, a);

  // ── Cache: second read within TTL doesn't re-fetch ───────────────────────────────────────────
  let calls = 0;
  const counting = ((url: string) => { calls++; return Promise.resolve(/post_impressions_unique/.test(url) ? reachEnv(1, 1) : engageEnv(0, {})); }) as unknown as typeof fetch;
  await fetchFbPostInsights('t', 'cached', counting, 5000);
  const firstCalls = calls;
  await fetchFbPostInsights('t', 'cached', counting, 5000 + 60_000);
  check('cache: 2nd read within TTL no re-fetch', calls === firstCalls, { calls, firstCalls });

  // ── Small page: reach group WITHHELD, engage group OK → reach null, engaged measured ─────────
  const smallPage = ((url: string) => Promise.resolve(/post_impressions_unique/.test(url) ? errEnv : engageEnv(0, {}))) as unknown as typeof fetch;
  const s = await fetchFbPostInsights('t', 'small', smallPage, 6000);
  check('small page: reach null (withheld)', s.reach === null && s.impressions === null, s);
  check('small page: engaged still measured (0)', s.engaged === 0, s);

  // ── sum over 2 full posts ────────────────────────────────────────────────────────────────────
  const map: Record<string, [number, number, number]> = { pA: [800, 1000, 5], pB: [400, 500, 3] };
  const many = ((url: string) => {
    const id = url.split('/insights')[0]!.split('/').pop()!;
    const [reach, impr, clk] = map[id] ?? [0, 0, 0];
    return Promise.resolve(/post_impressions_unique/.test(url) ? reachEnv(reach, impr) : engageEnv(clk, {}));
  }) as unknown as typeof fetch;
  const sum = await sumFbInsights('o', ['pA', 'pB'], { token: 't', fetchFn: many, now: 7000 });
  check('sum: reach 800+400', sum.measuredReach === 1200, sum);
  check('sum: impressions 1000+500', sum.measuredImpressions === 1500, sum);
  check('sum: engaged 5+3', sum.measuredEngaged === 8, sum);
  check('sum: postsMeasured = 2', sum.postsMeasured === 2, sum);
  check('sum: platforms = [facebook]', sum.platforms.join() === 'facebook', sum.platforms);

  // ── all-error → every field null (keeps estimate, not a false 0) ─────────────────────────────
  const allErr = ((_: string) => Promise.resolve(errEnv)) as unknown as typeof fetch;
  const dead = await sumFbInsights('o', ['x1', 'x2'], { token: 't', fetchFn: allErr, now: 8000 });
  check('degrade: all-error → reach & engaged null', dead.measuredReach === null && dead.measuredEngaged === null && dead.postsMeasured === 0, dead);

  // ── no ids / no token → null ────────────────────────────────────────────────────────────────
  check('empty: no ids → null', (await sumFbInsights('o', [], { token: 't', fetchFn: allErr, now: 9000 })).measuredReach === null);
  check('empty: no token → null', (await sumFbInsights('o', ['z'], { token: null, fetchFn: many, now: 9100 })).measuredReach === null);
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — fb insights → impact green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
