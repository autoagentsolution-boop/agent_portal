// Scheduler cron. Fires every minute; runSchedulerTick handles its own locking
// (overlapping ticks short-circuit on the advisory lock). Mounted from server.ts
// when ENABLE_SCHEDULER_CRON=1. Replaces the n8n schedule trigger.
import cron from 'node-cron';
import { runSchedulerTick } from './tick.ts';
import { runResumeDueTick } from './resume-due-runs.ts';
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

// Generic resume-due-runs cron (generic-scheduler node). Same 1-min cadence, its OWN advisory lock key
// (inside runResumeDueTick) so it never blocks/starves the publish tick. Mounted behind its own env flag.
export const startSchedulerResumeCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runResumeDueTick()
      .then((r) => {
        if (r.picked) logger.info('scheduler_resume_tick', { ...r });
      })
      .catch((e) => logger.error('scheduler_resume_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('scheduler_resume_cron_started', { schedule: SCHEDULE });
};
