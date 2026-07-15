// Live comment fetcher for LinkedIn (§01.4 platform coverage). Reads comments on Atria's OWN
// published ugcPost via the versionless /v2 socialActions API — the SAME free consumer tier
// (w_member_social scope, no legal-entity verification) the publish adapter uses (see
// src/social/linkedin.ts's own note on why it avoids /rest/* Community Management endpoints).
//   GET /v2/socialActions/{urn}/comments  (urn = the urn:li:... id stored in commentSourceIds)
// ⚠️ LIVE-UNTESTED — LinkedIn's consumer-tier comment-read scope/quota has not been exercised
// against a real token. If /v2 socialActions turns out to require the versioned /rest/* API for
// this app's product grant, switch the base URL and add the `LinkedIn-Version` header; the
// X-Restli-Protocol-Version header below is already required by both.
import { getActiveToken } from '../../../tokens/service.ts';
import { withRetry } from '../../../lib/retry.ts';
import { logger } from '../../../lib/logger.ts';
import { PostGoneError, type FetchedComment } from '../comment-poller.ts';

// Phase 03 hardening: a 403 here on the consumer w_member_social tier means comment-READ needs the
// Community Management / partner-program grant this app doesn't have — a STATIC capability limit,
// not a transient failure. Logged once at info (not a recurring warn) so it doesn't look like a
// real error on every 30-min tick; still degrades to a clean [] no-op either way.
let loggedScopeGap = false;

export const fetchLinkedinComments = async (
  platformPostId: string,
  ownerId: string,
): Promise<FetchedComment[]> => {
  const token = await getActiveToken(ownerId, 'linkedin');
  const urn = decodeURIComponent(platformPostId); // stored as literal colons; encode fresh below
  const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(urn)}/comments`;
  const res = await withRetry(
    () => fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
    }),
    { label: 'linkedin_comments' },
  );
  if (res.status === 404) throw new PostGoneError('linkedin', platformPostId);
  const j = (await res.json()) as { elements?: Array<Record<string, unknown>>; message?: string };
  if (res.status === 403) {
    if (!loggedScopeGap) {
      logger.info('linkedin_comments_scope_unavailable', { detail: (j.message ?? '').slice(0, 160) });
      loggedScopeGap = true;
    }
    return [];
  }
  if (!res.ok) {
    logger.warn('linkedin_comments_error', { status: res.status, error: (j.message ?? '').slice(0, 160) });
    return [];
  }
  return (j.elements ?? []).map((c) => ({
    id: String(c.$URN ?? c.id ?? ''),
    authorName: typeof c.actor === 'string' ? c.actor : null,
    // LinkedIn's `actor` IS a urn:li:... string, not a bare id — kept in authorName (used as the
    // Phase 03 handle-only identity fallback) rather than double-counted as authorId.
    authorId: null,
    text: String((c.message as { text?: string } | undefined)?.text ?? ''),
  }));
};
