// Scheduler cron. Fires every minute; runSchedulerTick handles its own locking
// (overlapping ticks short-circuit on the advisory lock). Mounted from server.ts
// when ENABLE_SCHEDULER_CRON=1. Replaces the n8n schedule trigger.
import cron from 'node-cron';
import { runSchedulerTick } from './tick.ts';
import { logger } from '../lib/logger.ts';

const SCHEDULE = '* * * * *'; // every minute

export const startSchedulerCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runSchedulerTick()
      .then((r) => {
        if (r.picked) logger.info('scheduler_tick', { ...r });
      })
      .catch((e) => logger.error('scheduler_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('scheduler_cron_started', { schedule: SCHEDULE });
};
