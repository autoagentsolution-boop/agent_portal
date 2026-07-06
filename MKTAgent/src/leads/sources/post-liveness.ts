// Per-platform post liveness check (Leads: "does this published link still exist on the platform?").
// A post can be published to several platforms; the user may delete it on one/all after testing. This
// reuses the SAME "object gone" signal the comment poller uses (a fetch that throws PostGoneError =
// deleted) so a link's liveness matches whether the collector can still read its comments. On-demand
// only (a real API call per platform) — never run automatically. Also SELF-HEALS: a dead WATCHED
// source is removed from commentSourceIds, and when none remain the collector is marked post_deleted.
import { prisma } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';
import { graphCommentFetcher } from './comment-fetch-graph.ts';
import { PostGoneError } from './comment-poller.ts';
import { extractPostId } from './comment-watch.ts';
import type { Post, SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

const COMMENTABLE = new Set<SocialPlatform>(['facebook', 'instagram', 'threads', 'linkedin', 'x']);

// alive: true = reachable, false = deleted on-platform, null = couldn't determine (transient/auth,
// or a platform we can't check — e.g. an unparseable URL or a LIVE-UNTESTED tier limit).
export interface LinkStatus { platform: string; url: string; alive: boolean | null }

export const checkPostLinks = async (post: Post, ownerId: string): Promise<LinkStatus[]> => {
  const postUrls = (post.postUrls ?? {}) as Record<string, string>;
  const sources = (post.commentSourceIds ?? {}) as Record<string, string>;
  const liveSources = { ...sources };
  const results: LinkStatus[] = [];

  for (const [platformKey, url] of Object.entries(postUrls)) {
    const platform = platformKey as SocialPlatform;
    if (!COMMENTABLE.has(platform)) { results.push({ platform, url, alive: null }); continue; }
    // Prefer the id the collector already recorded; else derive it from the publish URL.
    const id = sources[platform] ?? extractPostId(platform, url);
    if (!id) { results.push({ platform, url, alive: null }); continue; }
    let alive: boolean | null;
    try {
      await graphCommentFetcher(platform, id, ownerId); // [] or comments = reachable
      alive = true;
    } catch (e) {
      alive = e instanceof PostGoneError ? false : null; // gone = deleted; else unknown, keep watching
    }
    results.push({ platform, url, alive });
    if (alive === false) delete liveSources[platform]; // deleted → stop watching this platform
  }

  // Persist self-heal only if a WATCHED source actually died.
  if (JSON.stringify(liveSources) !== JSON.stringify(sources)) {
    const noneLeft = Object.keys(sources).length > 0 && Object.keys(liveSources).length === 0;
    await prisma.post.update({
      where: { id: post.id },
      data: { commentSourceIds: liveSources, ...(noneLeft ? { leadCollectorStatus: 'post_deleted' } : {}) },
    });
    logger.info('post_links_checked', { postId: post.id, stopped: noneLeft, dead: results.filter((r) => r.alive === false).map((r) => r.platform) });
  }
  return results;
};
