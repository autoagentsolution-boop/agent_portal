// X (Twitter) adapter — image post. Ported from the n8n X branch. 2-step:
// POST /2/media/upload (multipart binary, media_category=tweet_image) →
// POST /2/tweets (text + media.media_ids). OAuth2 user-context bearer with
// scope tweet.write + media.write (the predefined n8n cred lacked media.write —
// here the token comes from the store and must carry media.write).
// COST: X charges per post ($0.015 plain, $0.20 with-link) → copyX has NO real
// URL ("link in bio"). 280-char hard cap.
import { withRetry } from '../lib/retry.ts';
import { getActiveToken } from '../tokens/service.ts';
import { assetStore } from '../assets/store.ts';
import { logger } from '../lib/logger.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const ok = (url: string, platformPostId: string | null = null, degraded = false): PublishResult => ({ platform: 'x', ok: true, url, error: degraded ? 'image dropped (media tier) — posted text-only' : null, platformPostId, degraded });
const fail = (msg: string): PublishResult => ({
  platform: 'x',
  ok: false,
  url: null,
  error: ('X: ' + msg).slice(0, 300),
});

// 280-char hard cap; prefer x, fall back to threads then body.
const tweetText = (input: PublishInput): string => {
  let t = (input.x || input.threads || input.body || '').trim();
  if (t.length > 280) {
    t = t.slice(0, 277);
    t = t.slice(0, t.lastIndexOf(' ')) + '…';
  }
  return t;
};

export const xAdapter: SocialAdapter = {
  platform: 'x',
  supports: ['image'] as AssetType[],
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'x');
      const auth = { Authorization: `Bearer ${token}` };
      const ref = input.assets[0];
      if (!ref) return fail('no asset for image post');

      // 1) upload media (multipart binary). v2 /2/media/upload needs media.write scope AND a
      // paid access tier — free/limited apps get a 403 Forbidden here. Rather than fail the whole
      // X post, DEGRADE to a text-only tweet (X is text-first; copyX already carries the message).
      let mediaId: string | null = null;
      try {
        const { bytes, contentType } = await assetStore.fetchBinary(ref);
        const form = new FormData();
        form.append('media_category', 'tweet_image');
        form.append('media', new Blob([new Uint8Array(bytes)], { type: contentType }), 'image');
        const upRes = await withRetry(
          () => fetch('https://api.twitter.com/2/media/upload', { method: 'POST', headers: auth, body: form }),
          { label: 'x_media' },
        );
        const up = (await upRes.json()) as any;
        mediaId = up?.media_id_string || up?.data?.id || up?.media_id || null;
        if (!upRes.ok || !mediaId) {
          // 403 = app lacks media.write / paid tier for media upload → text-only fallback.
          // Any other non-ok also degrades to text rather than dropping the post entirely.
          logger.warn('x_media_upload_degraded_to_text', {
            ownerId: input.ownerId, status: upRes.status, detail: JSON.stringify(up).slice(0, 160),
          });
          mediaId = null;
        }
      } catch (e) {
        logger.warn('x_media_upload_error_degraded_to_text', { ownerId: input.ownerId, error: String(e).slice(0, 160) });
        mediaId = null;
      }

      // 2) create tweet (with media when the upload succeeded, else text-only)
      const text = tweetText(input);
      if (!text && !mediaId) return fail('nothing to post (no text and media upload unavailable)');
      const twRes = await withRetry(
        () =>
          fetch('https://api.twitter.com/2/tweets', {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(mediaId ? { text, media: { media_ids: [String(mediaId)] } } : { text }),
          }),
        { label: 'x_tweet' },
      );
      const tw = (await twRes.json()) as any;
      const tid = tw?.data?.id;
      if (!twRes.ok || !tid) return fail(`tweet failed: ${twRes.status} ${JSON.stringify(tw).slice(0, 120)}`);
      // Degraded (H1c): an image was requested (ref present) but its upload failed → we posted
      // text-only. Surface it so the aggregator demotes posted→partial (never a silent clean ok).
      const degraded = Boolean(ref) && mediaId === null;
      return ok(`https://twitter.com/i/web/status/${tid}`, String(tid), degraded);
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
