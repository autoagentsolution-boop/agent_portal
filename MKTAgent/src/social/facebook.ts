// Facebook adapter — image / carousel / video. Ported from the n8n FB nodes
// (mkt-post-scheduler FB branch + mkt-publish-carousel + mkt-publish-video).
// Graph v25.0, page token from the encrypted token store.
//
// - image:    POST /{page}/photos   (multipart binary, published=true)
// - carousel: N× POST /{page}/photos published=false → collect media_fbid →
//             POST /{page}/feed attached_media (fail-loud if any upload fails)
// - video:    POST /{page}/videos   (multipart binary, non-resumable; short clips)
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import { getActiveToken, getTokenMeta } from '../tokens/service.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import { assetStore } from '../assets/store.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const G = env.GRAPH_VERSION;
const ok = (url: string): PublishResult => ({ platform: 'facebook', ok: true, url, error: null });
const fail = (msg: string): PublishResult => ({
  platform: 'facebook',
  ok: false,
  url: null,
  error: ('FB: ' + msg).slice(0, 300),
});

const pageId = async (ownerId: string): Promise<string> => {
  const meta = await getTokenMeta(ownerId, 'facebook');
  // OAuth token meta → paste-token vault field → env (DAIS default).
  const id = (meta?.pageId as string) || (await getPublisherAppCred(ownerId, 'facebook_page_id')) || env.MKT_FB_PAGE_ID;
  if (!id) throw new Error('FB page id missing');
  return id;
};

const postForm = async (url: string, form: FormData): Promise<any> => {
  const res = await withRetry(() => fetch(url, { method: 'POST', body: form }), { label: 'fb_post' });
  return res.json();
};

const errMsg = (j: any, fallbackMsg: string): string => {
  const e = j?.error;
  if (e) return typeof e === 'string' ? e : e.message ?? JSON.stringify(e);
  return j?.message ?? fallbackMsg;
};

async function publishImage(input: PublishInput, token: string, page: string): Promise<PublishResult> {
  const ref = input.assets[0];
  if (!ref) return fail('no asset for image post');
  const { bytes, contentType } = await assetStore.fetchBinary(ref);
  const form = new FormData();
  form.append('message', input.body);
  form.append('published', 'true');
  form.append('access_token', token);
  form.append('source', new Blob([new Uint8Array(bytes)], { type: contentType }), 'image');
  const j = await postForm(`https://graph.facebook.com/${G}/${page}/photos`, form);
  const pid = j?.post_id || j?.id;
  if (pid && !j?.error) return ok(`https://facebook.com/${pid}`);
  return fail(errMsg(j, 'photo publish failed'));
}

async function uploadUnpublished(ref: { id: string }, token: string, page: string): Promise<string> {
  const { bytes, contentType } = await assetStore.fetchBinary(ref);
  const form = new FormData();
  form.append('published', 'false');
  form.append('access_token', token);
  form.append('source', new Blob([new Uint8Array(bytes)], { type: contentType }), 'image');
  const j = await postForm(`https://graph.facebook.com/${G}/${page}/photos`, form);
  const id = j?.id || j?.post_id;
  if (!id || j?.error) throw new Error(errMsg(j, 'unpublished upload failed'));
  return String(id);
}

async function publishCarousel(input: PublishInput, token: string, page: string): Promise<PublishResult> {
  if (input.assets.length < 2) return fail('carousel needs >=2 assets');
  if (input.assets.length > 10) return fail('carousel max 10 assets');
  // Fail-loud: any upload throws → whole carousel fails (no partial carousel).
  const fbids: string[] = [];
  for (const ref of input.assets) {
    fbids.push(await uploadUnpublished(ref, token, page));
  }
  const form = new FormData();
  form.append('message', input.body);
  form.append('access_token', token);
  form.append('attached_media', JSON.stringify(fbids.map((id) => ({ media_fbid: id }))));
  const j = await postForm(`https://graph.facebook.com/${G}/${page}/feed`, form);
  const pid = j?.id || j?.post_id;
  if (pid && !j?.error) return ok(`https://facebook.com/${pid}`);
  return fail(errMsg(j, 'carousel feed post failed'));
}

async function publishVideo(input: PublishInput, token: string, page: string): Promise<PublishResult> {
  const ref = input.assets[0];
  if (!ref) return fail('no asset for video post');
  const { bytes, contentType } = await assetStore.fetchBinary(ref);
  const form = new FormData();
  form.append('description', input.body);
  form.append('access_token', token);
  form.append('source', new Blob([new Uint8Array(bytes)], { type: contentType }), 'video.mp4');
  const j = await postForm(`https://graph.facebook.com/${G}/${page}/videos`, form);
  const vid = j?.id;
  if (vid && !j?.error) return ok(`https://www.facebook.com/watch/?v=${vid}`);
  return fail(errMsg(j, 'video publish failed'));
}

export const facebookAdapter: SocialAdapter = {
  platform: 'facebook',
  supports: ['image', 'carousel', 'video'] as AssetType[],
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'facebook');
      const page = await pageId(input.ownerId);
      if (input.assetType === 'carousel') return await publishCarousel(input, token, page);
      if (input.assetType === 'video') return await publishVideo(input, token, page);
      return await publishImage(input, token, page);
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
