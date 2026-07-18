// Charged vs not-charged spend — the ONE definition every cost report shares.
//
// The product rule (owner, 2026-07-18): cost is transparent, nothing is excluded, and the ONLY spend
// a tenant is not billed for is spend on a run that FAILED. Reports must show both halves so a user
// can see what they paid for and what they didn't, and the two must agree everywhere.
//
// Before this, each surface derived credits its own way and none of them separated failed spend, so
// the Usage page, the Impact report and the actual wallet debit could all disagree about the same
// run. This module is the single source of truth; surfaces render it, they do not recompute it.
//
// CREDIT SCALE. Credits here are derived from real USD (creditsFromUsd), matching what
// workflow-run-repo.runCredits debits. The older token-passthrough scale (creditsFromTokens) prices
// EVERY token at the flash OUTPUT rate ($2.50/1M) — measured actual is $1.40-$2.01/1M — so a
// prompt-heavy run reads high against a bill computed from real cost. Tokens stay visible as tokens;
// money is quoted in one currency.
import { prisma } from '../db/client.ts';
import { creditsFromUsd } from './credits.ts';

export interface SpendBucket {
  costUsd: number;
  totalTokens: number;
  credits: number;
}

export interface SpendSplit {
  // Spend on runs that reached a billable end state (completed, or parked mid-flow with reviewable
  // output). This is what reconcileRunDebit actually took from the wallet.
  charged: SpendBucket;
  // Spend the tenant was NOT billed for, itemised so "not charged" is never a black box:
  //   failedRuns — a run errored mid-DAG; product decision 2026-07-15 bills nothing for it, even for
  //                nodes that completed before the failure (workflow-executor.ts reconcileCredits).
  //   offRun     — spend with no run attached (chat turns, intake parsing, lead re-scoring). It never
  //                passes through reconcileRunDebit, so it is free to the tenant by construction.
  notCharged: SpendBucket & { failedRuns: SpendBucket; offRun: SpendBucket };
}

const bucket = (costUsd: number, totalTokens: number): SpendBucket => ({
  costUsd,
  totalTokens,
  credits: creditsFromUsd(costUsd),
});

const sum = (a: SpendBucket, b: SpendBucket): SpendBucket => bucket(a.costUsd + b.costUsd, a.totalTokens + b.totalTokens);

// Split one owner's ledger. `since` narrows to a reporting period (Impact); omit for all-time (Usage).
export const spendSplitFor = async (ownerId: string, since?: Date): Promise<SpendSplit> => {
  const at = since ? { gte: since } : undefined;

  // Failed run ids first: llmUsage has runId but no status, and Prisma cannot join across them in an
  // aggregate. Owner-scoped, so the id set stays bounded by one tenant's history.
  const failed = await prisma.workflowRun.findMany({ where: { ownerId, status: 'failed' }, select: { id: true } });
  const failedIds = failed.map((r) => r.id);

  const where = { ownerId, ...(at ? { createdAt: at } : {}) };
  const [failedAgg, offRunAgg, chargedAgg] = await Promise.all([
    failedIds.length
      ? prisma.llmUsage.aggregate({ where: { ...where, runId: { in: failedIds } }, _sum: { costUsd: true, totalTokens: true } })
      : Promise.resolve({ _sum: { costUsd: 0, totalTokens: 0 } }),
    prisma.llmUsage.aggregate({ where: { ...where, runId: null }, _sum: { costUsd: true, totalTokens: true } }),
    prisma.llmUsage.aggregate({
      where: { ...where, runId: { not: null, ...(failedIds.length ? { notIn: failedIds } : {}) } },
      _sum: { costUsd: true, totalTokens: true },
    }),
  ]);

  const failedRuns = bucket(failedAgg._sum.costUsd ?? 0, failedAgg._sum.totalTokens ?? 0);
  const offRun = bucket(offRunAgg._sum.costUsd ?? 0, offRunAgg._sum.totalTokens ?? 0);
  const charged = bucket(chargedAgg._sum.costUsd ?? 0, chargedAgg._sum.totalTokens ?? 0);

  return { charged, notCharged: { ...sum(failedRuns, offRun), failedRuns, offRun } };
};
