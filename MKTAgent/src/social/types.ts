// Social adapter contract. Ported verbatim from the n8n results[] invariant:
// every adapter returns PublishResult{platform,ok,url,error}; the scheduler
// aggregates these into posted|partial|error. Keeping the shape identical means
// the aggregation logic ports 1:1.
import type { SocialPlatform, AssetType } from '../../prisma/generated/prisma/client.ts';
import type { AssetRef } from '../assets/store.ts';

export interface PublishInput {
  postId: string;
  // Tenant that owns the post → selects which (owner, platform) token the adapter
  // publishes with (T4). Carried from Post.ownerId (T2 denorm) via resolve-input.
  ownerId: string;
  assetType: AssetType;
  // Resolved asset refs in display order (1 for image/video, 2-10 for carousel).
  assets: AssetRef[];
  // Language-agnostic copy bag — all variants are in the post's resolved language.
  // Adapter picks by length budget: body (FB/IG/LinkedIn), threads (≤480), x (≤280).
  body: string;
  threads: string;
  x: string;
}

export interface PublishResult {
  platform: SocialPlatform;
  ok: boolean;
  url: string | null;
  error: string | null;
  // Platform's canonical object id for the published post (numeric media id for IG/Threads,
  // {page}_{post} for FB, tweet id for X, share urn for LinkedIn). The lead collector + liveness
  // check need an id the platform API RESOLVES — the public permalink shortcode does NOT resolve on
  // Graph (a shortcode always yields code 100, indistinguishable from a genuine delete). Captured
  // here at publish so we never fall back to parsing the shortcode. null when publish failed.
  platformPostId?: string | null;
}

export interface SocialAdapter {
  platform: SocialPlatform;
  // Which asset types this adapter can publish (FB: all; others added per phase).
  supports: AssetType[];
  publish(input: PublishInput): Promise<PublishResult>;
}
