#!/usr/bin/env node
// CLI status reporter — queries Postgres via Prisma, prints ascii tables.
// Run from repo root: npx tsx scripts/status.ts [--week|--jobs|--cost|--logs <jobId>]

import { PrismaClient } from '@videofarm/db';

const prisma = new PrismaClient();

type RawRow = Record<string, unknown>;

const printTable = (rows: RawRow[], emptyMsg = '(no rows)'): void => {
  if (!rows.length) {
    console.log(emptyMsg);
    return;
  }
  console.table(rows);
};

const last24h = async (): Promise<void> => {
  console.log('=== Last 24h ===');
  const since = new Date(Date.now() - 24 * 3600_000);
  const jobs = await prisma.videoJob.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, pipeline: true, status: true, niche: true, costUsd: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  printTable(jobs as unknown as RawRow[]);

  const failures = await prisma.runLog.findMany({
    where: { level: 'error', createdAt: { gte: since } },
    select: { jobId: true, step: true, detail: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (failures.length) {
    console.log('\n=== Recent errors ===');
    printTable(failures as unknown as RawRow[]);
  }
};

const lastWeek = async (): Promise<void> => {
  console.log('=== Last 7 days by pipeline ===');
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT pipeline::text,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status='published')::int AS published,
           COUNT(*) FILTER (WHERE status='failed')::int AS failed,
           COALESCE(SUM(cost_usd), 0)::float AS cost_usd
    FROM video_job
    WHERE created_at > now() - interval '7 days'
    GROUP BY pipeline
    ORDER BY pipeline
  `;
  printTable(rows);
};

const recentJobs = async (): Promise<void> => {
  console.log('=== Last 20 jobs ===');
  const jobs = await prisma.videoJob.findMany({
    select: {
      id: true, pipeline: true, status: true, costUsd: true, createdAt: true,
      uploads: { select: { platform: true, status: true, url: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const flat = jobs.map((j) => ({
    id: j.id.slice(0, 8),
    pipeline: j.pipeline,
    status: j.status,
    cost: j.costUsd,
    created: j.createdAt.toISOString().slice(0, 16),
    yt: j.uploads.find((u) => u.platform === 'youtube')?.url ?? '',
    fb: j.uploads.find((u) => u.platform === 'facebook')?.url ?? '',
  }));
  printTable(flat as unknown as RawRow[]);
};

const costBreakdown = async (): Promise<void> => {
  console.log('=== Cost by provider (last 30d, from asset table) ===');
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT provider,
           kind::text,
           COUNT(*)::int AS items,
           pg_size_pretty(SUM(bytes)::bigint) AS bytes
    FROM asset
    WHERE created_at > now() - interval '30 days'
    GROUP BY provider, kind
    ORDER BY items DESC
  `;
  printTable(rows);

  console.log('\n=== Cost by pipeline (last 30d) ===');
  const byPipe = await prisma.$queryRaw<RawRow[]>`
    SELECT pipeline::text,
           COUNT(*)::int AS jobs,
           COALESCE(SUM(cost_usd), 0)::float AS cost_usd
    FROM video_job
    WHERE created_at > now() - interval '30 days'
    GROUP BY pipeline
    ORDER BY cost_usd DESC
  `;
  printTable(byPipe);
};

const jobLogs = async (jobId: string): Promise<void> => {
  console.log(`=== Logs for ${jobId} ===`);
  const logs = await prisma.runLog.findMany({
    where: { jobId },
    select: { createdAt: true, level: true, step: true, detail: true },
    orderBy: { createdAt: 'asc' },
  });
  printTable(logs as unknown as RawRow[]);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--week')) await lastWeek();
    else if (args.includes('--jobs')) await recentJobs();
    else if (args.includes('--cost')) await costBreakdown();
    else if (args.includes('--logs')) {
      const idx = args.indexOf('--logs');
      const id = args[idx + 1];
      if (!id) throw new Error('--logs requires a jobId');
      await jobLogs(id);
    } else await last24h();
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err: unknown) => {
  console.error('status error:', err);
  process.exit(1);
});
