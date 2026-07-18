// Charged vs absorbed spend — the ONE definition every cost report shares.
//
// Product rules this encodes (owner decisions):
//   1. Cost is transparent. Nothing is hidden from the user.
//   2. A run that FAILS bills nothing — not even steps that completed before it broke
//      (2026-07-15, workflow-executor.ts reconcileCredits).
//   3. RE-RUNS ARE ON US (2026-07-18, policy (c) of docs/product/06 §3.8). Re-generating a node
//      costs the tenant nothing beyond the latest attempt. This is a DELIBERATE stance for the
//      early-adopter period, not a bug — see the note on `reruns` below.
//
// Sources, and why they differ. The wallet debits `wf_node_run.cost_usd` (workflow-run-repo
// .runCredits); `mkt_llm_usage` appends a row per real API call. wf_node_run holds a node's LATEST
// cost and is overwritten when the node re-runs, so the two ledgers diverge by exactly the re-run
// spend. Reporting the difference is what makes rule 3 visible instead of silent.
import { prisma } from '../db/client.ts';
import { creditsFromUsd } from './credits.ts';

export interface SpendBucket {
  costUsd: number;
  totalTokens: number;
  credits: number;
}

export interface SpendSplit {
  // What the wallet actually took: the runCredits basis, restricted to runs that did not fail.
  charged: SpendBucket;
  // Everything we paid for and the tenant did not, itemised so "free" is never a black box.
  absorbed: SpendBucket & {
    // Runs that errored mid-DAG. Rule 2.
    failedRuns: SpendBucket;
    // Re-generated nodes. Rule 3 — the gap between the append-only call ledger and the
    // overwritten-per-node billing basis. Media re-runs dominate this (an image is ~$0.04 a shot).
    reruns: SpendBucket;
    // Work with no run attached: chat turns, intake parsing, lead re-scoring, voice. Never passes
    // through reconcileRunDebit, so it is free by construction.
    offRun: SpendBucket;
  };
}

const bucket = (costUsd: number, totalTokens: number): SpendBucket => ({
  costUsd: Math.max(0, costUsd),
  totalTokens: Math.max(0, totalTokens),
  credits: creditsFromUsd(Math.max(0, costUsd)),
});

const add = (...b: SpendBucket[]): SpendBucket =>
  bucket(b.reduce((s, x) => s + x.costUsd, 0), b.reduce((s, x) => s + x.totalTokens, 0));

export const spendSplitFor = async (ownerId: string): Promise<SpendSplit> => {
  // Failed run ids first: neither ledger carries run status, and Prisma cannot join across them in
  // an aggregate. Owner-scoped, so the set stays bounded by one tenant's history.
  const failed = await prisma.workflowRun.findMany({ where: { ownerId, status: 'failed' }, select: { id: true } });
  const failedIds = failed.map((r) => r.id);
  const notFailed = failedIds.length ? { notIn: failedIds } : undefined;

  const [chargedNodes, failedNodes, allNodes, refine, offRunAgg, runAttached] = await Promise.all([
    // The debit basis, exactly as runCredits computes it.
    prisma.workflowNodeRun.aggregate({
      where: { ownerId, ...(notFailed ? { runId: notFailed } : {}) },
      _sum: { costUsd: true, totalTokens: true },
    }),
    failedIds.length
      ? prisma.workflowNodeRun.aggregate({ where: { ownerId, runId: { in: failedIds } }, _sum: { costUsd: true, totalTokens: true } })
      : Promise.resolve({ _sum: { costUsd: 0, totalTokens: 0 } }),
    // Every node's CURRENT cost — the ceiling of what the billing basis can see across all runs.
    prisma.workflowNodeRun.aggregate({ where: { ownerId }, _sum: { costUsd: true, totalTokens: true } }),
    // Ad-hoc spend billed alongside a run but raised outside the DAG (a post /refine).
    prisma.llmUsage.aggregate({
      where: { ownerId, surface: 'copygen_refine', ...(notFailed ? { runId: notFailed } : {}) },
      _sum: { costUsd: true, totalTokens: true },
    }),
    prisma.llmUsage.aggregate({ where: { ownerId, runId: null }, _sum: { costUsd: true, totalTokens: true } }),
    // Every real call attributed to a run. Excludes copygen_refine, already counted as charged.
    prisma.llmUsage.aggregate({
      where: { ownerId, runId: { not: null }, surface: { not: 'copygen_refine' } },
      _sum: { costUsd: true, totalTokens: true },
    }),
  ]);

  const charged = add(
    bucket(chargedNodes._sum.costUsd ?? 0, chargedNodes._sum.totalTokens ?? 0),
    bucket(refine._sum.costUsd ?? 0, refine._sum.totalTokens ?? 0),
  );
  const failedRuns = bucket(failedNodes._sum.costUsd ?? 0, failedNodes._sum.totalTokens ?? 0);
  const offRun = bucket(offRunAgg._sum.costUsd ?? 0, offRunAgg._sum.totalTokens ?? 0);

  // Re-run spend = what we actually called minus what the per-node basis still shows. Clamped at 0:
  // the two ledgers came online at different times (mkt_llm_usage in the 2026-07-06 migration), so on
  // old tenants the node basis can exceed the call ledger. A negative here means "no measurable
  // re-run spend", never a credit back.
  const reruns = bucket(
    (runAttached._sum.costUsd ?? 0) - (allNodes._sum.costUsd ?? 0),
    (runAttached._sum.totalTokens ?? 0) - (allNodes._sum.totalTokens ?? 0),
  );

  return { charged, absorbed: { ...add(failedRuns, reruns, offRun), failedRuns, reruns, offRun } };
};
