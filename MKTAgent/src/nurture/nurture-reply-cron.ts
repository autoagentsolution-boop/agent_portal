// Lead Nurture reply-poller cron (Phase 02). Mirrors nurture-cron.ts/comment-cron.ts: every 5 minutes,
// sweeps every owner with a live Gmail-threaded nurture conversation for new lead replies. Mounted
// from server.ts only when ENABLE_NURTURE_REPLY_CRON=1 — off by default, so nothing is read until
// explicitly turned on. READ only (HARD invariant #1); never a general inbox scan (invariant #2, see
// nurture-reply-poller.ts). A single owner's fetch failure or missing read scope never aborts the tick.
import cron from 'node-cron';
import { pollNurtureReplies } from './nurture-reply-poller.ts';
import { logger } from '../lib/logger.ts';

const SCHEDULE = '*/5 * * * *'; // every 5 min

export const startNurtureReplyCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    pollNurtureReplies()
      .then((r) => {
        if (r.repliesIngested || r.scopeMissing) logger.info('nurture_reply_cron_tick', { ...r });
      })
      .catch((e) => logger.error('nurture_reply_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('nurture_reply_cron_started', { schedule: SCHEDULE });
};
