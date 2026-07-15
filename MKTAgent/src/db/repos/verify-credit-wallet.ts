// Verify the credit wallet (credit-wallet Phase 01 + Phase 02 reconcile-debit fix): trial grant
// idempotency, super-admin grant, balance = SUM(delta), per-run credit computation, and the
// reconcile-debit's delta/race/park-charges-too behavior. One throwaway tenant, cleaned up. No
// LLM spend — all synthetic ledger + node rows.
//   npx tsx src/db/repos/verify-credit-wallet.ts
import { prisma } from '../client.ts';
import { getBalance, ensureTrialGrant, grantCredits, reconcileRunDebit, TRIAL_CREDITS } from './credit-repo.ts';
import { createRun, createNodes, runCredits } from './workflow-run-repo.ts';
import { creditsFromTokens, creditsFromUsd } from '../../cost/credits.ts';

let failed = 0;
const ok = (cond: boolean, label: string): void => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++; };

const main = async (): Promise<void> => {
  const user = await prisma.user.create({ data: { email: `credit-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const owner = user.id;
  try {
    console.log('trial grant');
    ok((await getBalance(owner)) === 0, 'empty ledger → balance 0');
    ok((await ensureTrialGrant(owner)) === true, 'first trial grant applied');
    ok((await getBalance(owner)) === TRIAL_CREDITS, `balance = ${TRIAL_CREDITS} after trial`);
    ok((await ensureTrialGrant(owner)) === false, 'second trial grant is a no-op (idempotent)');
    ok((await getBalance(owner)) === TRIAL_CREDITS, 'balance unchanged after repeat trial');

    console.log('concurrent first-login race (TOCTOU guard)');
    const racer = await prisma.user.create({ data: { email: `credit-race-${Date.now()}@test.local`, defaultLanguage: 'en' } });
    try {
      const results = await Promise.all([ensureTrialGrant(racer.id), ensureTrialGrant(racer.id), ensureTrialGrant(racer.id)]);
      ok(results.filter(Boolean).length === 1, 'exactly one of 3 concurrent grants applies');
      ok((await getBalance(racer.id)) === TRIAL_CREDITS, `concurrent grants → balance ${TRIAL_CREDITS}, not a multiple`);
    } finally {
      await prisma.creditLedger.deleteMany({ where: { ownerId: racer.id } });
      await prisma.user.delete({ where: { id: racer.id } });
    }

    console.log('super-admin grant (multiple grants stay additive)');
    await grantCredits(owner, 500, 'demo grant', owner);
    ok((await getBalance(owner)) === TRIAL_CREDITS + 500, 'balance rises by grant amount');
    await grantCredits(owner, 100, 'second demo grant', owner);
    ok((await getBalance(owner)) === TRIAL_CREDITS + 600, 'a second grant is ADDITIVE, not idempotent');

    console.log('per-run credits + reconcile debit: first charge (PARK, not just completion)');
    // A run that PARKS (e.g. needs_approval) still spent real tokens on the node(s) that ran
    // before the gate — this is exactly the under-billing bug: the run never reaches `completed`,
    // so the old one-shot debitRun never fired. reconcileRunDebit must charge it at the park point.
    const run = await createRun({ ownerId: owner, goal: {}, status: 'needs_approval' });
    await createNodes(run.id, owner, [{ nodeId: 'n1', agentId: 'concept_writer', dependsOn: [] }]);
    // 3000 tokens + $0.04 media → creditsFromTokens(3000) + creditsFromUsd(0.04)
    await prisma.workflowNodeRun.updateMany({ where: { runId: run.id }, data: { totalTokens: 3000, costUsd: 0.04 } });
    const expected = creditsFromTokens(3000) + creditsFromUsd(0.04);
    const computed = await runCredits(run.id, owner);
    ok(computed === expected, `runCredits = ${expected} (tokens+media)`);

    const before = await getBalance(owner);
    const firstDebit = await reconcileRunDebit(owner, run.id, computed);
    ok(firstDebit === expected, `reconcile at PARK debits the full concept cost (${expected})`);
    ok((await getBalance(owner)) === before - expected, 'balance dropped by run cost after park-time reconcile');

    console.log('resume-then-complete debits only the DELTA (no double charge)');
    // Same run resumes: more nodes run (e.g. publisher), adding cost on top of what's already
    // billed. The SECOND reconcile call must charge ONLY the new delta, not the run's full total —
    // otherwise a resumed run is billed twice for its already-parked spend.
    await createNodes(run.id, owner, [{ nodeId: 'n2', agentId: 'publisher', dependsOn: ['n1'] }]);
    await prisma.workflowNodeRun.updateMany({ where: { runId: run.id, nodeId: 'n2' }, data: { totalTokens: 1000, costUsd: 0 } });
    const totalNow = await runCredits(run.id, owner);
    const expectedDelta = totalNow - expected;
    ok(expectedDelta > 0, 'second stop point adds MORE cost on top of the first');
    const secondDebit = await reconcileRunDebit(owner, run.id, totalNow);
    ok(secondDebit === expectedDelta, `second reconcile charges only the delta (${expectedDelta}), not the full total again`);
    ok((await getBalance(owner)) === before - totalNow, 'balance now down by the FULL run cost — not double-charged');

    // A third reconcile at the SAME cost (e.g. the run parks again with no new spend) must be a
    // pure no-op — nothing new to charge.
    const thirdDebit = await reconcileRunDebit(owner, run.id, totalNow);
    ok(thirdDebit === 0, 'reconcile at unchanged cost debits nothing (no phantom charge)');
    ok((await getBalance(owner)) === before - totalNow, 'balance still exactly the full run cost, once');

    console.log('concurrent stop-points on the same run do not double-charge (advisory-lock race guard)');
    // Simulate an SSE-driven reconcile racing a manual resume's reconcile — both observe the SAME
    // new total (as if a single node's cost just landed) and race to bill the delta. Only one
    // should land; the advisory lock (keyed on runId) serializes the read-then-insert.
    const raceBalanceBefore = await getBalance(owner);
    const raceTotal = totalNow + 50;
    const [raceA, raceB, raceC] = await Promise.all([
      reconcileRunDebit(owner, run.id, raceTotal),
      reconcileRunDebit(owner, run.id, raceTotal),
      reconcileRunDebit(owner, run.id, raceTotal),
    ]);
    const raceLanded = [raceA, raceB, raceC].filter((d) => d > 0);
    ok(raceLanded.length === 1 && raceLanded[0] === 50, 'exactly one of 3 concurrent reconciles charges the 50-credit delta');
    ok((await getBalance(owner)) === raceBalanceBefore - 50, 'balance reflects the delta exactly once, not 3x');

    console.log('a zero-cost reconcile is a no-op');
    const run2 = await createRun({ ownerId: owner, goal: {}, status: 'planned' });
    ok((await reconcileRunDebit(owner, run2.id, 0)) === 0, 'zero-cost run debits nothing');

    // Distinct runs each reconcile independently.
    ok((await reconcileRunDebit(owner, run2.id, 10)) === 10, 'a different run debits independently');
    ok((await getBalance(owner)) === raceBalanceBefore - 50 - 10, 'balance reflects both runs\' debits');
  } finally {
    await prisma.workflowNodeRun.deleteMany({ where: { ownerId: owner } });
    await prisma.workflowRun.deleteMany({ where: { ownerId: owner } });
    await prisma.creditLedger.deleteMany({ where: { ownerId: owner } });
    await prisma.user.delete({ where: { id: owner } });
    console.log('cleanup: throwaway tenant removed');
  }
  console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILED`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
