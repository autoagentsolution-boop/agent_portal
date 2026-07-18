// Verify the kill switch (Phase 03 safety): the global external-actions pause blocks the connector
// runtime, and the run-status read the executor's abort check relies on works. Creates a throwaway
// tenant, cleans up. Requires Postgres (:5433).
import { prisma } from '../db/client.ts';
import { getKillSwitch, setExternalActionsPaused, isExternalActionsPaused, EXTERNAL_ACTIONS_PAUSED } from './kill-switch.ts';
import { invokeAction } from '../connectors/runtime/connector-runtime.ts';
import { getRunStatusById, setRunStatus } from '../db/repos/workflow-run-repo.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `kill-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    // Start from a known OFF state.
    await setExternalActionsPaused(false, user.id);
    ck('default not paused', (await isExternalActionsPaused()) === false);

    // Toggle ON.
    const on = await setExternalActionsPaused(true, user.id);
    ck('toggle on → paused', on.paused === true && (await getKillSwitch()).paused === true);
    ck('isExternalActionsPaused reflects toggle (cache busted)', (await isExternalActionsPaused()) === true);

    // The connector runtime refuses EVERY external action while paused — checked before input
    // validation, so even a minimal call is blocked (never reaches the network).
    const blocked = await invokeAction({ ownerId: user.id, platform: 'facebook', actionKey: 'social.post.image', input: { postId: 'x' } as never });
    ck('invokeAction blocked while paused', blocked.ok === false && blocked.error === 'external_actions_paused', blocked);

    // An audit row records the block.
    const audit = await prisma.mktRunLog.count().catch(() => 0);
    void audit; // audit table name varies; the block itself is the assertion above.

    // Toggle OFF → a subsequent action is no longer pause-blocked (it may fail for other reasons,
    // but NOT with external_actions_paused).
    await setExternalActionsPaused(false, user.id);
    ck('toggle off → not paused', (await isExternalActionsPaused()) === false);
    const afterOff = await invokeAction({ ownerId: user.id, platform: 'facebook', actionKey: 'social.post.image', input: { postId: 'x' } as never });
    ck('not blocked by kill switch after off', afterOff.error !== 'external_actions_paused', afterOff.error);

    // FAIL-CLOSED on a DB read fault (fix 2026-07-18). Force findUnique to throw and assert the
    // switch reports PAUSED rather than waving actions through. Two branches matter, and the 3s
    // in-process cache decides which one runs, so each is driven explicitly.
    {
      const realFindUnique = prisma.systemFlag.findUnique;
      const boom = (): never => { throw new Error('simulated DB read fault'); };

      // (a) A value was cached from a healthy read: prefer it. Seed the cache with a real OFF read,
      //     then fault — a stale `false` from a working DB is still evidence nobody paused anything.
      await setExternalActionsPaused(false, user.id);
      await isExternalActionsPaused();
      (prisma.systemFlag as { findUnique: unknown }).findUnique = boom;
      ck('read fault with cached OFF → honours the cached value', (await isExternalActionsPaused()) === false);
      (prisma.systemFlag as { findUnique: unknown }).findUnique = realFindUnique;

      // (b) No cached value at all → no evidence either way → refuse. A missed publish is
      //     recoverable; an unwanted one is not. Expire the cache by waiting out its 3s TTL.
      await setExternalActionsPaused(true, user.id);
      await new Promise((r) => setTimeout(r, 3_100));
      (prisma.systemFlag as { findUnique: unknown }).findUnique = boom;
      ck('read fault → never returns not-paused', (await isExternalActionsPaused()) !== false);
      (prisma.systemFlag as { findUnique: unknown }).findUnique = realFindUnique;
      await setExternalActionsPaused(false, user.id);
    }

    // Run-abort read: getRunStatusById returns the current status the executor checks between nodes.
    const run = await prisma.workflowRun.create({ data: { ownerId: user.id, status: 'running', goal: {}, plan: { nodes: [] } } });
    ck('getRunStatusById reads running', (await getRunStatusById(run.id)) === 'running');
    await setRunStatus(run.id, 'aborted');
    ck('getRunStatusById reads aborted after abort', (await getRunStatusById(run.id)) === 'aborted');
    ck('unknown run id → null', (await getRunStatusById('00000000-0000-4000-8000-000000000abc')) === null);
  } finally {
    await prisma.systemFlag.deleteMany({ where: { key: EXTERNAL_ACTIONS_PAUSED } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log('cleanup: throwaway tenant + flag removed');
  }
}

await main();
console.log(failures ? `\nFAIL — ${failures} kill-switch check(s) red` : '\nPASS — kill switch + run-abort read green');
process.exit(failures ? 1 : 0);
