// Lead Nurture Agent driver cron (Phase 01). Mirrors autonomy-cron.ts: every 2 min it enrolls
// eligible leads, reconciles parked touches, and claims/plans due threads (runNurtureOnce). Mounted
// from server.ts only when ENABLE_NURTURE_CRON=1 — off by default, so nothing is enrolled/planned
// until explicitly turned on. Overlapping ticks are safe: the thread claim is an atomic guarded
// updateMany (nurture-thread-repo.claimDueThread), so a thread can be picked up by only one tick.
import cron from 'node-cron';
import { runNurtureOnce } from './nurture-runner.ts';
import { logger } from '../lib/logger.ts';

const SCHEDULE = '2-59/2 * * * *'; // every 2 min, offset to :02 (autonomy is :01, resume-runs :00)

export const startNurtureCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    runNurtureOnce()
      .then((r) => {
        if (r.enrolled || r.advanced || r.planned || r.failed) logger.info('nurture_cron_tick', { ...r });
      })
      .catch((e) => logger.error('nurture_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('nurture_cron_started', { schedule: SCHEDULE });
};
