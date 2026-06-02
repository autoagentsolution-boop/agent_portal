import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@videofarm/db';
import type { LogLevel, LogStep } from '@videofarm/db/enums';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://videofarm:videofarm@localhost:5432/videofarm';

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

export const logRun = async (
  jobId: string,
  level: LogLevel,
  step: LogStep,
  detail?: Record<string, unknown>,
): Promise<void> => {
  await prisma.runLog.create({
    data: {
      jobId,
      level,
      step,
      detail: (detail ?? {}) as Prisma.InputJsonValue,
    },
  });
};

export const markJobRendered = async (
  jobId: string,
  videoPath: string,
): Promise<void> => {
  await prisma.videoJob.update({
    where: { id: jobId },
    data: { videoPath, status: 'uploading', finishedAt: new Date() },
  });
};
