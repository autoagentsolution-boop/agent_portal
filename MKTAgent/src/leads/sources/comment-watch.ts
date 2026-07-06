// After a post with a lead-capture keyword publishes, record WHICH platform post the poller
// should read comments from (§01.6 — the lead_collector wiring). Derives the platform post id
// from the publish URL for every commentable platform (FB, IG, Threads, LinkedIn, X); a URL we
// can't parse an id from is skipped (logged), not guessed.
import { prisma } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';
import type { Post, SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

const COMMENTABLE = new Set<SocialPlatform>(['facebook', 'instagram', 'threads', 'linkedin', 'x']);

// Pull the platform post id from a publish URL.
//   FB:       last path segment of facebook.com/<id>
//   IG:       the /p/<id>/ segment (a media id when we fell back to it; a shortcode otherwise —
//             the live IG fetch is best-effort, see comment-fetch-graph).
//   Threads:  the segment after `post` (real permalink `@user/post/{code}`) or after `t`
//             (our own `/t/{mediaId}` fallback link) — same best-effort caveat as IG: this may
//             be a shortcode rather than the numeric media id the replies endpoint expects.
//   LinkedIn: the last segment of linkedin.com/feed/update/<urn> — the FULL urn:li:... string
//             (colons are valid, unencoded path characters; kept verbatim).
//   X:        the segment after `status` (covers both x.com/<user>/status/<id> and our own
//             twitter.com/i/web/status/<id> publish URL).
// IG/Threads media ids the Graph comments/replies + liveness endpoints resolve are all-numeric;
// a permalink shortcode (letters/dashes) never resolves. Used to decide whether a stored id is
// trustworthy for those two platforms (FB {page}_{post} + LinkedIn urn are not gated by this).
export const isNumericId = (id: string): boolean => /^\d+$/.test(id);

export const extractPostId = (platform: SocialPlatform, url: string): string | null => {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const after = (marker: string): string | null => {
      const i = segs.indexOf(marker);
      return i >= 0 ? segs[i + 1] ?? null : null;
    };
    // A page-video permalink is facebook.com/watch/?v=<id> → the id is the `v` query param (the path's
    // last segment is the literal "watch"). Feed/photo posts carry the id as the last path segment.
    if (platform === 'facebook') return u.searchParams.get('v') ?? segs[segs.length - 1] ?? null;
    if (platform === 'instagram') return after('p') ?? segs[segs.length - 1] ?? null;
    if (platform === 'threads') return after('post') ?? after('t') ?? segs[segs.length - 1] ?? null;
    if (platform === 'linkedin') return after('update') ?? segs[segs.length - 1] ?? null;
    if (platform === 'x') return after('status') ?? segs[segs.length - 1] ?? null;
    return null;
  } catch {
    return null;
  }
};

// Build + persist the platform→postId map the poller watches. No-op when the post has no
// capture keyword or nothing published to a commentable platform.
export const recordCommentSources = async (
  post: Post,
  postUrls: Record<string, string>,
  platformIds?: Record<string, string>,
): Promise<void> => {
  if (!post.leadCaptureKeyword) return;
  // Prefer the canonical resolvable id captured at publish (fresh map from the tick, or persisted on
  // the post for activate-from-Leads). Fall back to parsing the URL only when no captured id exists
  // (legacy rows) — that fallback yields a shortcode for IG/Threads, which the poller then treats as
  // unresolvable rather than a phantom delete (see meta/threads fetcher guards).
  const ids = platformIds ?? ((post.platformPostIds ?? {}) as Record<string, string>);
  const sources: Record<string, string> = {};
  for (const [platformKey, url] of Object.entries(postUrls)) {
    const platform = platformKey as SocialPlatform;
    if (!COMMENTABLE.has(platform) || !url) continue;
    const id = ids[platform] ?? extractPostId(platform, url);
    if (id) sources[platform] = id;
    else logger.warn('comment_source_id_unparsed', { postId: post.id, platform, url: url.slice(0, 80) });
  }
  if (Object.keys(sources).length === 0) return;
  // Recording fresh sources = the post is (re)published and watchable → clear any prior
  // 'post_deleted' stop so a re-published post reactivates its collector.
  await prisma.post.update({ where: { id: post.id }, data: { commentSourceIds: sources, leadCollectorStatus: null } });
  logger.info('comment_sources_recorded', { postId: post.id, platforms: Object.keys(sources), keyword: post.leadCaptureKeyword });
};
