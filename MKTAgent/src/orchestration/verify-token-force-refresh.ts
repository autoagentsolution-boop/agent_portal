// Verify the force-refresh gate on refreshIfDue (the "X won't renew" fix): a stale token with a
// bogus far-future expiry must NOT attempt refresh on the normal (window-gated) path, but MUST when
// forced — which getActiveToken's stale path now does. Pure: the stub's refresh() throws a sentinel
// BEFORE any persist, so we assert whether the gate let the refresh call be reached. No DB writes.
import { refreshIfDue } from '../tokens/service.ts';
import type { TokenRecord } from '../db/repos/token-repo.ts';
import type { PlatformTokenProvider } from '../tokens/types.ts';

const OWNER = '6455c2bd-67cc-48cb-ab77-5ead25747d02';
const REACHED = new Error('refresh-reached'); // thrown iff the gate lets refresh() run

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const stub: PlatformTokenProvider = {
  platform: 'x',
  refreshWhenWithinMs: 15 * 60 * 1000,
  async check() { return { alive: true }; },
  async refresh() { throw REACHED; },
};

// needs_attention token whose (untrustworthy) expiry is 60 days out → NOT within the 15-min window.
const rec: TokenRecord = {
  ownerId: OWNER, platform: 'x', token: 'OLD', refreshToken: 'OLD_R',
  expiresAt: new Date(Date.now() + 60 * 24 * 3600_000), status: 'needs_attention', meta: null,
};

async function main(): Promise<void> {
  // unforced: far-future expiry → gate blocks → refresh() never reached → refreshed:false, no throw.
  const unforced = await refreshIfDue(OWNER, 'x', rec, stub);
  check('unforced: far-future expiry → refresh NOT attempted', unforced.refreshed === false && unforced.token === 'OLD', unforced);

  // forced: gate bypassed → refresh() reached → throws the sentinel.
  let reached = false;
  try { await refreshIfDue(OWNER, 'x', rec, stub, true); } catch (e) { reached = e === REACHED; }
  check('forced: gate bypassed → refresh attempted', reached);

  // no provider.refresh → force is a no-op (nothing to call).
  const noRefresh = { ...stub, refresh: undefined } as unknown as PlatformTokenProvider;
  const nr = await refreshIfDue(OWNER, 'x', rec, noRefresh, true);
  check('forced + no provider.refresh → not refreshed', nr.refreshed === false, nr);
}

main()
  .then(() => { console.log(failures === 0 ? '\nPASS — force-refresh gate green' : `\nFAIL — ${failures} check(s)`); process.exit(failures === 0 ? 0 : 1); })
  .catch((e) => { console.error(e); process.exit(1); });
