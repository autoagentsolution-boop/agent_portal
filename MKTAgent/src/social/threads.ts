// Threads adapter — image only (video deferred). Ported from the n8n Threads
// branch. graph.threads.net/v1.0. 2-step: create container (media_type=IMAGE,
// public image_url, text) → wait for processing → threads_publish → GET permalink
// (publish returns only an id; threads.net/t/{id} is a guess and 404s).
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import { getActiveToken, getTokenMeta } from '../tokens/service.ts';
import { assetStore } from '../assets/store.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const TV = env.THREADS_VERSION;
const ok = (url: string): PublishResult => ({ platform: 'threads', ok: true, url, error: null });
const fail = (msg: string): PublishResult => ({
  platform: 'threads',
  ok: false,
  url: null,
  error: ('Threads: ' + msg).slice(0, 300),
});

// Threads caps text at 500 chars even for image posts. Prefer the standalone
// threads variant, fall back to the long body; truncate on a word boundary.
const threadsText = (input: PublishInput): string => {
  let t = (input.threads || input.body || '').trim();
  if (t.length > 500) {
    t = t.slice(0, 497);
    t = t.slice(0, t.lastIndexOf(' ')) + '…';
  }
  return t;
};

const userId = async (ownerId: string): Promise<string> => {
  const meta = await getTokenMeta(ownerId, 'threads');
  const id = (meta?.userId as string) || env.MKT_THREADS_USER_ID;
  if (!id) throw new Error('Threads user id missing');
  return id;
};

const getJson = async (url: string, init?: RequestInit): Promise<any> => {
  const res = await withRetry(() => fetch(url, init), { label: 'threads_http' });
  return res.json();
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const threadsAdapter: SocialAdapter = {
  platform: 'threads',
  supports: ['image'] as AssetType[],
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'threads');
      const user = await userId(input.ownerId);
      const ref = input.assets[0];
      if (!ref) return fail('no asset for image post');
      const imageUrl = assetStore.publicUrl(ref);
      const text = threadsText(input);

      // 1) create container
      const create = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads?media_type=IMAGE&image_url=${encodeURIComponent(imageUrl)}&text=${encodeURIComponent(text)}&access_token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const creationId = create?.id;
      if (!creationId || create?.error) return fail(create?.error?.message ?? 'container create failed');

      // 2) Threads needs ~30s to ingest the image before publish.
      await sleep(35000);

      // 3) publish
      const pub = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads_publish?creation_id=${encodeURIComponent(creationId)}&access_token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const mediaId = pub?.id;
      if (!mediaId || pub?.error) return fail(pub?.error?.message ?? 'threads_publish failed');

      // 4) permalink (publish returns id only)
      const perma = await getJson(
        `https://graph.threads.net/${TV}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      );
      return ok(perma?.permalink ?? `https://www.threads.net/t/${mediaId}`);
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
