// Prisma client (PG adapter) + audit log helper. Mirrors render-service/src/db.ts.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../prisma/generated/prisma/client.ts';
import { env } from '../config/env.ts';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export type LogLevel = 'info' | 'warn' | 'error';

// Append an audit row to mkt_run_log. detail is free-form JSON. ownerId is
// optional (T2): tenant-attributed events pass it; system/cron events omit it.
export const logRun = async (
  level: LogLevel,
  step: string,
  detail?: Record<string, unknown>,
  ownerId?: string,
): Promise<void> => {
  await prisma.mktRunLog.create({
    data: { level, step, detail: (detail ?? {}) as object, ownerId: ownerId ?? null },
  });
};
