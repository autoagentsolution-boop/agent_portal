// After a post with a lead-capture keyword publishes, record WHICH platform post the poller
// should read comments from (§01.6 — the lead_collector wiring). Derives the platform post id
// from the publish URL: FB `facebook.com/{postId}`, IG `.../p/{mediaId}/`. Only FB/IG are
// commentable today; a URL we can't parse an id from is skipped (logged), not guessed.
import { prisma } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';
import type { Post, SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

const COMMENTABLE = new Set<SocialPlatform>(['facebook', 'instagram']);

// Pull the platform post id from a publish URL. FB: last path segment of facebook.com/<id>.
// IG: the /p/<id>/ segment (a media id when we fell back to it; a shortcode otherwise — the
// live IG fetch is best-effort, see comment-fetch-graph).
export const extractPostId = (platform: SocialPlatform, url: string): string | null => {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (platform === 'facebook') return segs[segs.length - 1] ?? null;
    if (platform === 'instagram') {
      const i = segs.indexOf('p');
      return i >= 0 ? segs[i + 1] ?? null : segs[segs.length - 1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
};

// Build + persist the platform→postId map the poller watches. No-op when the post has no
// capture keyword or nothing published to a commentable platform.
export const recordCommentSources = async (post: Post, postUrls: Record<string, string>): Promise<void> => {
  if (!post.leadCaptureKeyword) return;
  const sources: Record<string, string> = {};
  for (const [platformKey, url] of Object.entries(postUrls)) {
    const platform = platformKey as SocialPlatform;
    if (!COMMENTABLE.has(platform) || !url) continue;
    const id = extractPostId(platform, url);
    if (id) sources[platform] = id;
    else logger.warn('comment_source_id_unparsed', { postId: post.id, platform, url: url.slice(0, 80) });
  }
  if (Object.keys(sources).length === 0) return;
  await prisma.post.update({ where: { id: post.id }, data: { commentSourceIds: sources } });
  logger.info('comment_sources_recorded', { postId: post.id, platforms: Object.keys(sources), keyword: post.leadCaptureKeyword });
};
