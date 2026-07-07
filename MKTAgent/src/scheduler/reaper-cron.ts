// Reaper cron. Every 5 min it runs one self-healing sweep (runReaperOnce). Mounted from
// server.ts when ENABLE_REAPER_CRON=1. Off the :00/:30 stampede at :03.
import cron from 'node-cron';
import { runReaperOnce } from './reaper.ts';
import { logger } from '../lib/logger.ts';

const SCHEDULE = '3-59/5 * * * *'; // every 5 min, offset to :03

export const startReaperCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runReaperOnce().catch((e) => logger.error('reaper_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('reaper_cron_started', { schedule: SCHEDULE });
};
