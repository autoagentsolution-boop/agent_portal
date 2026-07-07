// Lead-collector cron — automatically pulls comment-keyword leads from every owner's watched
// posts on a schedule (no manual /leads/poll-comments trigger needed). Every 30 min: a cadence
// that catches opt-in comments promptly without hammering the platform comment APIs. Mounted from
// server.ts when ENABLE_LEADS_CRON=1. Uses the live multi-platform comment fetcher.
import cron from 'node-cron';
import { pollCommentsForLeads } from './comment-poller.ts';
import { sweepPostLiveness } from './post-liveness.ts';
import { graphCommentFetcher } from './comment-fetch-graph.ts';
import { logger } from '../../lib/logger.ts';

const SCHEDULE = '*/30 * * * *'; // every 30 minutes

export const startLeadsCron = (): void => {
  cron.schedule(SCHEDULE, () => {
    // ownerId omitted → global sweep across all tenants' watched posts.
    pollCommentsForLeads(graphCommentFetcher)
      .then(async (r) => {
        if (r.leadsCaptured > 0 || r.postsPolled > 0) logger.info('leads_cron_tick', { ...r });
        // Feedback #3: AFTER polling, proactively verify each watched post still exists. Deleted
        // ones self-heal (sources dropped, collector → post_deleted) so next tick's query skips them.
        const live = await sweepPostLiveness();
        if (live.dead > 0) logger.info('leads_liveness_swept', { ...live });
      })
      .catch((e) => logger.error('leads_cron_failed', { error: String(e).slice(0, 200) }));
  });
  logger.info('leads_cron_started', { schedule: SCHEDULE });
};
