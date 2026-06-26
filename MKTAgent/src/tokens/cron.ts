// Token maintenance cron. Threads/X tokens are short-lived so we check hourly;
// the maintenance routine itself decides whether a given token is within its
// refresh window. Mounted from server.ts when ENABLE_TOKEN_CRON=1.
import cron from 'node-cron';
import { runTokenMaintenance } from './service.ts';
import { logger } from '../lib/logger.ts';

// Hourly at :17 (off the :00 stampede).
const SCHEDULE = '17 * * * *';

export const startTokenCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runTokenMaintenance().catch((e) =>
      logger.error('token_cron_failed', { error: String(e).slice(0, 200) }),
    );
  });
  logger.info('token_cron_started', { schedule: SCHEDULE });
};
