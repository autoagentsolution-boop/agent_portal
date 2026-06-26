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
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const ok = (url: string): PublishResult => ({ platform: 'x', ok: true, url, error: null });
const fail = (msg: string): PublishResult => ({
  platform: 'x',
  ok: false,
  url: null,
  error: ('X: ' + msg).slice(0, 300),
});

// 280-char hard cap; prefer copyX, fall back to copyThreads then copyVi.
const tweetText = (input: PublishInput): string => {
  let t = (input.copyX || input.copyThreads || input.copyVi || '').trim();
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
      const token = await getActiveToken('x');
      const auth = { Authorization: `Bearer ${token}` };
      const ref = input.assets[0];
      if (!ref) return fail('no asset for image post');

      // 1) upload media (multipart binary)
      const { bytes, contentType } = await assetStore.fetchBinary(ref);
      const form = new FormData();
      form.append('media_category', 'tweet_image');
      form.append('media', new Blob([new Uint8Array(bytes)], { type: contentType }), 'image');
      const upRes = await withRetry(
        () => fetch('https://api.twitter.com/2/media/upload', { method: 'POST', headers: auth, body: form }),
        { label: 'x_media' },
      );
      const up = (await upRes.json()) as any;
      const mediaId = up?.media_id_string || up?.data?.id || up?.media_id;
      if (!upRes.ok || !mediaId) return fail(`media upload failed: ${upRes.status} ${JSON.stringify(up).slice(0, 120)}`);

      // 2) create tweet
      const twRes = await withRetry(
        () =>
          fetch('https://api.twitter.com/2/tweets', {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: tweetText(input), media: { media_ids: [String(mediaId)] } }),
          }),
        { label: 'x_tweet' },
      );
      const tw = (await twRes.json()) as any;
      const tid = tw?.data?.id;
      if (!twRes.ok || !tid) return fail(`tweet failed: ${twRes.status} ${JSON.stringify(tw).slice(0, 120)}`);
      return ok(`https://twitter.com/i/web/status/${tid}`);
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
