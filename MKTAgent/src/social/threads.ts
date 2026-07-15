// Threads adapter — image only (video deferred). Ported from the n8n Threads
// branch. graph.threads.net/v1.0. 2-step: create container (media_type=IMAGE,
// public image_url, text) → wait for processing → threads_publish → GET permalink
// (publish returns only an id; threads.net/t/{id} is a guess and 404s).
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import { getActiveToken, getTokenMeta } from '../tokens/service.ts';
import { assetStore } from '../assets/store.ts';
import type { SocialAdapter, PublishInput, PublishResult, MentionInput, ReplyInput } from './types.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const TV = env.THREADS_VERSION;
const ok = (url: string, platformPostId: string | null = null): PublishResult => ({ platform: 'threads', ok: true, url, error: null, platformPostId });
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

// Access token in the Authorization header, NOT the URL query (Phase 06 / log hygiene) — a token
// in a URL leaks into access logs/proxies/traces. The Threads Graph API accepts Bearer.
const bearer = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// mention text: "@handle greeting…" within Threads' 500-char cap, same truncation rule as threadsText.
const mentionText = (handle: string, body: string): string => {
  let t = `@${handle.replace(/^@/, '')} ${body}`.trim();
  if (t.length > 500) {
    t = t.slice(0, 497);
    t = t.slice(0, t.lastIndexOf(' ')) + '…';
  }
  return t;
};

export const threadsAdapter: SocialAdapter = {
  platform: 'threads',
  supports: ['image', 'text'] as AssetType[],
  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'threads');
      const user = await userId(input.ownerId);

      // Text-only post (Fix D): media_type=TEXT container — no image_url, no 35s image ingest wait.
      if (input.assetType === 'text') {
        const text = threadsText(input);
        const create = await getJson(
          `https://graph.threads.net/${TV}/${user}/threads?media_type=TEXT&text=${encodeURIComponent(text)}`,
          bearer(token, { method: 'POST' }),
        );
        const cid = create?.id;
        if (!cid || create?.error) return fail(create?.error?.message ?? 'container create failed');
        const pub = await getJson(
          `https://graph.threads.net/${TV}/${user}/threads_publish?creation_id=${encodeURIComponent(cid)}`,
          bearer(token, { method: 'POST' }),
        );
        const mid = pub?.id;
        if (!mid || pub?.error) return fail(pub?.error?.message ?? 'threads_publish failed');
        const perma = await getJson(`https://graph.threads.net/${TV}/${mid}?fields=permalink`, bearer(token));
        return ok(perma?.permalink ?? `https://www.threads.net/t/${mid}`, String(mid));
      }

      const ref = input.assets[0];
      if (!ref) return fail('no asset for image post');
      const imageUrl = assetStore.publicUrl(ref);
      const text = threadsText(input);

      // 1) create container
      const create = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads?media_type=IMAGE&image_url=${encodeURIComponent(imageUrl)}&text=${encodeURIComponent(text)}`,
        bearer(token, { method: 'POST' }),
      );
      const creationId = create?.id;
      if (!creationId || create?.error) return fail(create?.error?.message ?? 'container create failed');

      // 2) Threads needs ~30s to ingest the image before publish.
      await sleep(35000);

      // 3) publish
      const pub = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads_publish?creation_id=${encodeURIComponent(creationId)}`,
        bearer(token, { method: 'POST' }),
      );
      const mediaId = pub?.id;
      if (!mediaId || pub?.error) return fail(pub?.error?.message ?? 'threads_publish failed');

      // 4) permalink (publish returns id only)
      const perma = await getJson(
        `https://graph.threads.net/${TV}/${mediaId}?fields=permalink`,
        bearer(token),
      );
      // Store the NUMERIC mediaId (not the permalink shortcode) — /{id}/replies + liveness resolve it.
      return ok(perma?.permalink ?? `https://www.threads.net/t/${mediaId}`, String(mediaId));
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },

  // mention (LIVE, Multi-channel Nurture Nodes Phase 02): a TEXT container on OUR OWN timeline whose
  // text opens with "@handle" — Threads allows @mentions inside a post your own account creates
  // (research: cannot mention "in someone else's context", which this isn't).
  async mention(input: MentionInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'threads');
      const user = await userId(input.ownerId);
      const text = mentionText(input.handle, input.body);
      const create = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads?media_type=TEXT&text=${encodeURIComponent(text)}`,
        bearer(token, { method: 'POST' }),
      );
      const cid = create?.id;
      if (!cid || create?.error) return fail(create?.error?.message ?? 'container create failed');
      const pub = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads_publish?creation_id=${encodeURIComponent(cid)}`,
        bearer(token, { method: 'POST' }),
      );
      const mid = pub?.id;
      if (!mid || pub?.error) return fail(pub?.error?.message ?? 'threads_publish failed');
      const perma = await getJson(`https://graph.threads.net/${TV}/${mid}?fields=permalink`, bearer(token));
      return ok(perma?.permalink ?? `https://www.threads.net/t/${mid}`, String(mid));
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },

  // reply (LIVE): same TEXT container flow as mention, plus `reply_to_id` targeting their post.
  async reply(input: ReplyInput): Promise<PublishResult> {
    try {
      const token = await getActiveToken(input.ownerId, 'threads');
      const user = await userId(input.ownerId);
      const text = input.body.trim().slice(0, 500);
      if (!text) return fail('nothing to reply with');
      const create = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads?media_type=TEXT&text=${encodeURIComponent(text)}&reply_to_id=${encodeURIComponent(input.postId)}`,
        bearer(token, { method: 'POST' }),
      );
      const cid = create?.id;
      if (!cid || create?.error) return fail(create?.error?.message ?? 'reply create failed');
      const pub = await getJson(
        `https://graph.threads.net/${TV}/${user}/threads_publish?creation_id=${encodeURIComponent(cid)}`,
        bearer(token, { method: 'POST' }),
      );
      const mid = pub?.id;
      if (!mid || pub?.error) return fail(pub?.error?.message ?? 'threads_publish failed');
      const perma = await getJson(`https://graph.threads.net/${TV}/${mid}?fields=permalink`, bearer(token));
      return ok(perma?.permalink ?? `https://www.threads.net/t/${mid}`, String(mid));
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
};
