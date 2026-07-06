// Aggregate per-platform PublishResult[] → terminal Post status + write-back.
// Ported 1:1 from the n8n "Aggregate results" node so behavior stays identical:
//   all ok (and >0)  → posted
//   some ok          → partial
//   none ok          → error
import type { PublishResult } from '../social/types.ts';
import type { PostStatus, Prisma } from '../../prisma/generated/prisma/client.ts';

export interface AggregateOutcome {
  status: Extract<PostStatus, 'posted' | 'partial' | 'error'>;
  postUrls: Record<string, string>;
  // Platform → canonical resolvable object id (numeric media id / {page}_{post} / tweet id / urn).
  // Persisted so the lead collector + liveness never fall back to the unresolvable permalink shortcode.
  platformPostIds: Record<string, string>;
  error: string | null;
  postedAt: Date;
}

export function aggregate(results: PublishResult[]): AggregateOutcome {
  const okCount = results.filter((r) => r.ok).length;
  const status: AggregateOutcome['status'] =
    okCount === results.length && okCount > 0 ? 'posted' : okCount > 0 ? 'partial' : 'error';

  const postUrls: Record<string, string> = {};
  const platformPostIds: Record<string, string> = {};
  for (const r of results) {
    if (!r.ok) continue;
    if (r.url) postUrls[r.platform] = r.url;
    if (r.platformPostId) platformPostIds[r.platform] = r.platformPostId;
  }

  const error =
    results
      .filter((r) => !r.ok)
      .map((r) => `${r.platform}:${r.error}`)
      .join(' | ')
      .slice(0, 500) || null;

  return { status, postUrls, platformPostIds, error, postedAt: new Date() };
}

// Shape the write-back for updatePost(). Kept separate so the tick stays thin.
export const toWriteBack = (o: AggregateOutcome): Prisma.PostUpdateInput => ({
  status: o.status,
  postUrls: o.postUrls as Prisma.InputJsonValue,
  platformPostIds: o.platformPostIds as Prisma.InputJsonValue,
  error: o.error,
  postedAt: o.postedAt,
});
