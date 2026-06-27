// Copy-gen cron. n8n ran every 10 min; we keep that cadence (Gemini calls cost
// money + the review gate is human-paced, no need for sub-minute polling).
// Mounted from server.ts when ENABLE_COPYGEN_CRON=1.
import cron from 'node-cron';
import { runCopyGenTick } from './service.ts';
import { logger } from '../lib/logger.ts';

const SCHEDULE = '*/10 * * * *'; // every 10 minutes

export const startCopyGenCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runCopyGenTick()
      .then((r) => {
        if (r.picked) logger.info('copygen_tick', { ...r });
      })
      .catch((e) => logger.error('copygen_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('copygen_cron_started', { schedule: SCHEDULE });
};
