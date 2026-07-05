// Instagram adapter — image only (Reels/video deferred). Ported from the n8n IG
// branch. GOTCHA: IG publishes via graph.FACEBOOK.com/{ig-user-id} using the
// shared PAGE token (instagram_content_publish), NOT graph.instagram.com.
// 2-step: create container (public image_url) → poll FINISHED → media_publish →
// GET permalink (publish returns only an id).
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import { getActiveToken, getTokenMeta } from '../tokens/service.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import { assetStore } from '../assets/store.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const G = env.GRAPH_VERSION;
const ok = (url: string): PublishResult => ({ platform: 'instagram', ok: true, url, error: null });
const fail = (msg: string): PublishResult => ({
  platform: 'instagram',
  ok: false,
  url: null,
  error: ('IG: ' + msg).slice(0, 300),
});

const igUserId = async (ownerId: string): Promise<string> => {
  const meta = await getTokenMeta(ownerId, 'instagram');
  // OAuth token meta → paste-token vault field → env (DAIS default).
  const id = (meta?.userId as string) || (await getPublisherAppCred(ownerId, 'instagram_business_account_id')) || env.MKT_IG_USER_ID;
  if (!id) throw new Error('IG user id missing');
  return id;
};

const getJson = async (url: string, init?: RequestInit): Promise<any> => {
  const res = await withRetry(() => fetch(url, init), { label: 'ig_http' });
  return res.json();
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function pollContainer(creationId: string, token: string): Promise<void> {
  // Container must reach status_code=FINISHED before publish. Poll up to ~60s.
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const j = await getJson(
      `https://graph.facebook.com/${G}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    if (j?.status_code === 'FINISHED') return;
    if (j?.status_code === 'ERROR') throw new Error('IG container processing ERROR');
  }
  throw new Error('IG container did not finish in time');
}

export const instagramAdapter: SocialAdapter = {
  platform: 'instagram',
  supports: ['image'] as AssetType[],
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'instagram');
      const user = await igUserId(input.ownerId);
      const ref = input.assets[0];
      if (!ref) return fail('no asset for image post');
      const imageUrl = assetStore.publicUrl(ref); // IG fetches server-side
      const caption = input.body;

      // 1) create container
      const create = await getJson(
        `https://graph.facebook.com/${G}/${user}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const creationId = create?.id;
      if (!creationId || create?.error) return fail(create?.error?.message ?? 'container create failed');

      // 2) wait for processing
      await pollContainer(creationId, token);

      // 3) publish
      const pub = await getJson(
        `https://graph.facebook.com/${G}/${user}/media_publish?creation_id=${encodeURIComponent(creationId)}&access_token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const mediaId = pub?.id;
      if (!mediaId || pub?.error) return fail(pub?.error?.message ?? 'media_publish failed');

      // 4) permalink (publish returns id only)
      const perma = await getJson(
        `https://graph.facebook.com/${G}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      );
      return ok(perma?.permalink ?? `https://www.instagram.com/p/${mediaId}/`);
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
