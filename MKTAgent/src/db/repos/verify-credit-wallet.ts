// Verify the credit wallet (credit-wallet Phase 01): trial grant idempotency, super-admin grant,
// balance = SUM(delta), per-run credit computation, and debit idempotency by runId. One throwaway
// tenant, cleaned up. No LLM spend — all synthetic ledger + node rows.
//   npx tsx src/db/repos/verify-credit-wallet.ts
import { prisma } from '../client.ts';
import { getBalance, ensureTrialGrant, grantCredits, debitRun, TRIAL_CREDITS } from './credit-repo.ts';
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

    console.log('super-admin grant');
    await grantCredits(owner, 500, 'demo grant', owner);
    ok((await getBalance(owner)) === TRIAL_CREDITS + 500, 'balance rises by grant amount');

    console.log('per-run credits + debit idempotency');
    const run = await createRun({ ownerId: owner, goal: {}, status: 'completed' });
    await createNodes(run.id, owner, [{ nodeId: 'n1', agentId: 'copy_writer', dependsOn: [] }]);
    // 3000 tokens + $0.04 media → creditsFromTokens(3000) + creditsFromUsd(0.04)
    await prisma.workflowNodeRun.updateMany({ where: { runId: run.id }, data: { totalTokens: 3000, costUsd: 0.04 } });
    const expected = creditsFromTokens(3000) + creditsFromUsd(0.04);
    const computed = await runCredits(run.id, owner);
    ok(computed === expected, `runCredits = ${expected} (tokens+media)`);

    const before = await getBalance(owner);
    ok((await debitRun(owner, computed, run.id)) === true, 'first debit applied');
    ok((await getBalance(owner)) === before - expected, 'balance dropped by run cost');
    ok((await debitRun(owner, computed, run.id)) === false, 'second debit same runId is a no-op (idempotent)');
    ok((await getBalance(owner)) === before - expected, 'balance unchanged after repeat debit');
    ok((await debitRun(owner, 0, run.id)) === false, 'zero-credit debit is a no-op (returns before DB)');

    // Distinct runs each debit once.
    const run2 = await createRun({ ownerId: owner, goal: {}, status: 'completed' });
    ok((await debitRun(owner, 10, run2.id)) === true, 'a different run debits independently');
    ok((await getBalance(owner)) === before - expected - 10, 'balance reflects both debits');
  } finally {
    await prisma.creditLedger.deleteMany({ where: { ownerId: owner } });
    await prisma.user.delete({ where: { id: owner } });
    console.log('cleanup: throwaway tenant removed');
  }
  console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILED`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
};

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
