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

export interface AdvisoryLock {
  acquired: boolean;
  release(): Promise<void>;
}

// Acquire a DB-global session advisory lock keyed by an arbitrary string.
// Each worker passes its own key so the scheduler and copy-gen don't block each
// other, but two ticks of the SAME worker (or the same worker across instances)
// serialize.
export async function acquireAdvisoryLock(key: string): Promise<AdvisoryLock> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query<{ got_lock: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS got_lock',
      [key],
    );
    if (r.rows[0]?.got_lock !== true) {
      await client.end();
      return { acquired: false, release: async () => {} };
    }
    return {
      acquired: true,
      release: async () => {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
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

// Scheduler keeps its original key (matches the n8n lock name byte-for-byte).
export const acquireSchedulerLock = (): Promise<AdvisoryLock> =>
  acquireAdvisoryLock('mkt-post-scheduler');
