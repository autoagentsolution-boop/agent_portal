// Live comment fetcher dispatcher (§01.4) — routes to the per-platform live fetcher in
// ./comment-fetchers/. This is the DEFAULT fetcher the poller + cron use; the poller/parse/
// capture logic itself is verified with an injected fake fetcher (see verify-leads-comments.ts).
// Each per-platform fetcher preserves the PostGoneError contract: throw it when the platform
// confirms the post/tweet/media no longer exists so the poller deactivates that collector;
// return [] for any transient/auth/tier error so the collector stays active and retries.
import { fetchMetaComments } from './comment-fetchers/meta.ts';
import { fetchThreadsComments } from './comment-fetchers/threads.ts';
import { fetchLinkedinComments } from './comment-fetchers/linkedin.ts';
import { fetchXComments } from './comment-fetchers/x.ts';
import type { CommentFetcher } from './comment-poller.ts';

export const graphCommentFetcher: CommentFetcher = async (platform, platformPostId, ownerId) => {
  switch (platform) {
    case 'facebook':
    case 'instagram':
      return fetchMetaComments(platform, platformPostId, ownerId);
    case 'threads':
      return fetchThreadsComments(platformPostId, ownerId);
    case 'linkedin':
      return fetchLinkedinComments(platformPostId, ownerId);
    case 'x':
      return fetchXComments(platformPostId, ownerId);
    default:
      return [];
  }
};
