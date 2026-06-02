import { prisma } from '../db.ts';

const DEFAULT_DAILY_CAP_USD = Number(process.env.MAX_DAILY_COST_USD ?? '2');

export interface PreflightResult {
  ok: boolean;
  spentTodayUsd: number;
  estimatedUsd: number;
  capUsd: number;
  remainingUsd: number;
}

export const preflightCost = async (estimatedUsd: number): Promise<PreflightResult> => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const agg = await prisma.videoJob.aggregate({
    where: { createdAt: { gte: start } },
    _sum: { costUsd: true },
  });
  const spent = Number(agg._sum.costUsd ?? 0);
  const cap = DEFAULT_DAILY_CAP_USD;
  const remaining = Math.max(0, cap - spent);
  return {
    ok: spent + estimatedUsd <= cap,
    spentTodayUsd: spent,
    estimatedUsd,
    capUsd: cap,
    remainingUsd: remaining,
  };
};
