// Autonomy kickoff cron. Every 2 min it claims + executes granted-but-unstarted runs (runAutonomyOnce).
// Mounted from server.ts when ENABLE_AUTONOMY_CRON=1. Off the :00 stampede at :01. Overlapping ticks
// are safe: the claim is an atomic guarded updateMany, so a run can be picked up by only one tick.
import cron from 'node-cron';
import { runAutonomyOnce } from './autonomy-runner.ts';
import { logger } from '../../lib/logger.ts';

const SCHEDULE = '1-59/2 * * * *'; // every 2 min, offset to :01

export const startAutonomyCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runAutonomyOnce()
      .then((r) => { if (r.claimed) logger.info('autonomy_cron_tick', { ...r }); })
      .catch((e) => logger.error('autonomy_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('autonomy_cron_started', { schedule: SCHEDULE });
};
