import { Prisma } from '@videofarm/db';
import type { JobStatus, LogLevel, LogStep } from '@videofarm/db/enums';
import { prisma, logRun } from '../db.ts';
import { logger } from '../logger.ts';

export interface CostBreakdown {
  composition_usd?: number;
  motion_usd?: number;
  narration_usd?: number;
  music_usd?: number;
  verify_usd?: number;
  total_usd: number;
}

export interface CreateJobInput {
  niche?: string;
  slug: string;
  script?: Record<string, unknown>;
}

export const createCookingJob = async (input: CreateJobInput): Promise<{ id: string }> => {
  // NOTE: `cooking_explode` enum value added in schema.prisma but requires
  // `npx prisma generate` after migration. Cast until client is regenerated.
  const job = await prisma.videoJob.create({
    data: {
      pipeline: 'cooking_explode' as 'quiz',
      niche: input.niche ?? 'cooking',
      status: 'generating',
      script: (input.script ?? { slug: input.slug }) as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
    select: { id: true },
  });
  logger.info('cooking_job_created', { jobId: job.id, slug: input.slug });
  return job;
};

export const logCookingStep = async (
  jobId: string,
  level: LogLevel,
  step: LogStep,
  detail: Record<string, unknown> = {},
): Promise<void> => {
  await logRun(jobId, level, step, detail);
};

export interface FinishJobInput {
  videoPath: string;
  cost: CostBreakdown;
  status?: JobStatus;
  error?: string;
}

export const finishCookingJob = async (
  jobId: string,
  input: FinishJobInput,
): Promise<void> => {
  const status: JobStatus = input.status ?? 'done';
  const existing = await prisma.videoJob.findUnique({
    where: { id: jobId },
    select: { script: true },
  });
  const baseScript =
    existing?.script && typeof existing.script === 'object' && !Array.isArray(existing.script)
      ? (existing.script as Record<string, unknown>)
      : {};
  const mergedScript = { ...baseScript, cost_breakdown: input.cost };

  await prisma.videoJob.update({
    where: { id: jobId },
    data: {
      status,
      videoPath: input.videoPath,
      costUsd: new Prisma.Decimal(input.cost.total_usd.toFixed(4)),
      finishedAt: new Date(),
      error: input.error,
      script: mergedScript as unknown as Prisma.InputJsonValue,
    },
  });
  logger.info('cooking_job_finished', { jobId, status, total_usd: input.cost.total_usd });
};

export const failCookingJob = async (jobId: string, error: string): Promise<void> => {
  await prisma.videoJob.update({
    where: { id: jobId },
    data: { status: 'failed', error: error.slice(0, 2000), finishedAt: new Date() },
  });
  logger.error('cooking_job_failed', { jobId, error: error.slice(0, 200) });
};
