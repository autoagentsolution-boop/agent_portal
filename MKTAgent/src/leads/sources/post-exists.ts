// Per-platform EXISTENCE check for the Leads liveness surface — "does this published object still
// exist on-platform?" — deliberately SEPARATE from comment-reading. The comment fetchers infer
// "reachable" from a successful/empty read, which is WRONG for liveness: LinkedIn 403 (consumer tier
// can't read the object) and X conversation-search 200-empty both look like "empty = alive". Here we
// only ever return alive:true on a POSITIVELY confirmed object read; every ambiguous outcome
// (auth/tier/rate, or an id the API can't resolve) is null, never true.
//
// Returns: true = confirmed alive · false = confirmed deleted · null = indeterminate.
// Verified live 2026-07-06 (report verify-260706-2007): FB subcode-33 on a valid id = genuine gone;
// IG/Threads need the NUMERIC media id (a shortcode always yields code 100 = indistinguishable);
// LinkedIn object read is 403 on w_member_social (unsupported); X signals gone via errors[].type
// resource-not-found at HTTP 200, NOT a 404.
import { env } from '../../config/env.ts';
import { getActiveToken } from '../../tokens/service.ts';
import { withRetry } from '../../lib/retry.ts';
import { logger } from '../../lib/logger.ts';
import { isMetaGraphPostGone } from './comment-fetchers/meta.ts';
import { isNumericId } from './comment-watch.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

const GRAPH = `https://graph.facebook.com/${env.GRAPH_VERSION || 'v21.0'}`;
const THREADS = `https://graph.threads.net/${env.THREADS_VERSION || 'v1.0'}`;

// Graph object existence (FB/IG/Threads): query the engagement EDGE (comments/replies), NOT the
// object directly. A direct `GET /{id}?fields=id` on a deleted post returns the AMBIGUOUS code 10
// ("does not exist OR missing permission OR unsupported") — indistinguishable from a permission gap
// on a live post. The comments/replies edge instead returns the CLEAN code 100 / subcode 33 / 404
// "object gone" signal on a valid deleted id (verified live). 200 (even empty data) = alive; gone
// signal = deleted; anything else (auth/rate/transient) = indeterminate.
const graphExists = async (base: string, id: string, token: string, edge: string, label: string): Promise<boolean | null> => {
  try {
    const url = `${base}/${encodeURIComponent(id)}/${edge}?fields=id&limit=1&access_token=${encodeURIComponent(token)}`;
    const res = await withRetry(() => fetch(url), { label });
    const j = (await res.json()) as { data?: unknown[]; error?: any };
    if (res.ok && !j?.error) return true;
    if (isMetaGraphPostGone(res.status, j?.error)) return false;
    logger.warn('liveness_indeterminate', { label, status: res.status, error: JSON.stringify(j?.error).slice(0, 120) });
    return null;
  } catch (e) {
    logger.warn('liveness_error', { label, error: String(e).slice(0, 120) });
    return null;
  }
};

const xExists = async (id: string, token: string): Promise<boolean | null> => {
  try {
    const res = await withRetry(
      () => fetch(`https://api.twitter.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=id`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { label: 'x_exists' },
    );
    // X returns HTTP 200 for BOTH alive and deleted; the delete signal is in the body, not the status.
    const j = (await res.json()) as { data?: { id?: string }; errors?: Array<{ type?: string }> };
    if (res.status === 401 || res.status === 403 || res.status === 429) return null; // tier/rate → can't tell
    if (j?.data?.id) return true;
    if (j?.errors?.some((e) => (e.type ?? '').endsWith('resource-not-found'))) return false;
    return null;
  } catch (e) {
    logger.warn('liveness_error', { label: 'x_exists', error: String(e).slice(0, 120) });
    return null;
  }
};

export const checkPlatformAlive = async (
  platform: SocialPlatform,
  id: string,
  ownerId: string,
): Promise<boolean | null> => {
  // LinkedIn: every object-read endpoint 403s on the consumer (w_member_social) tier — existence is
  // genuinely unverifiable here, so NEVER assert alive:true. Skip the call entirely.
  if (platform === 'linkedin') return null;
  // IG/Threads: a permalink shortcode never resolves on Graph → indeterminate, not "deleted".
  if ((platform === 'instagram' || platform === 'threads') && !isNumericId(id)) return null;

  let token: string;
  try {
    token = await getActiveToken(ownerId, platform);
  } catch {
    return null; // no token → can't determine
  }

  switch (platform) {
    case 'facebook':
    case 'instagram':
      return graphExists(GRAPH, id, token, 'comments', `${platform}_exists`);
    case 'threads':
      return graphExists(THREADS, id, token, 'replies', 'threads_exists');
    case 'x':
      return xExists(id, token);
    default:
      return null;
  }
};
