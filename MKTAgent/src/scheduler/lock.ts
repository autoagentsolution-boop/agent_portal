// Postgres session-scoped advisory lock for the scheduler.
//
// Ported from the n8n nodes:
//   acquire → SELECT pg_try_advisory_lock(hashtext('mkt-post-scheduler'))
//   release → SELECT pg_advisory_unlock(hashtext('mkt-post-scheduler'))
//
// CRITICAL: a session-level advisory lock is bound to the connection that took
// it. Acquire and unlock MUST run on the same pg session or the unlock is a
// silent no-op and the lock leaks until that connection dies. Prisma pools
// connections (any query may land on a different one), so the lock CANNOT use
// the shared Prisma client — it gets its own dedicated pg.Client whose lifetime
// equals the tick. If the process crashes mid-tick the connection drops and
// Postgres auto-releases the lock.
//
// The lock is DB-global, so it also serializes across multiple app instances
// pointing at the same database — not just overlapping cron ticks in one process.
import pg from 'pg';
import { env } from '../config/env.ts';

const LOCK_KEY = 'mkt-post-scheduler';

export interface SchedulerLock {
  acquired: boolean;
  release(): Promise<void>;
}

export async function acquireSchedulerLock(): Promise<SchedulerLock> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query<{ got_lock: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS got_lock',
      [LOCK_KEY],
    );
    if (r.rows[0]?.got_lock !== true) {
      await client.end();
      return { acquired: false, release: async () => {} };
    }
    return {
      acquired: true,
      release: async () => {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
        } finally {
          await client.end();
        }
      },
    };
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
}
