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
  // The post went out but NOT as the intended deliverable — e.g. X dropped the image (media 403 /
  // free tier) and posted text-only. Still ok:true (something published, and we never re-post), but
  // the aggregator demotes the overall outcome posted→partial and records the degrade so an
  // autonomous run never reads a reduced publish as a clean full success (H1c). Optional; absent =
  // full-fidelity publish.
  degraded?: boolean;
  // Greeting DRY-RUN marker (Multi-channel Nurture Nodes Phase 02): true when this result is a
  // SIMULATED mention/reply — no network call was made (src/social/greeting.ts's default live gate,
  // or a stub greetFn). Always absent/false for publish() and for a real greetTo call.
  dryRun?: boolean;
}

// Mention/reply input (Multi-channel Nurture Nodes Phase 02) — a public, person-directed greeting:
// an @mention in OUR OWN new post, or a reply to THEIR post. Asset-less (text only) by design; `ok`/
// `fail` reuse PublishResult so the greeting fan-out (src/social/greeting.ts) aggregates identically
// to publishTo.
export interface MentionInput {
  ownerId: string;
  // The target's handle to @mention, WITHOUT a leading '@' or WITH — adapters normalize it.
  handle: string;
  body: string;
}

export interface ReplyInput {
  ownerId: string;
  // The platform's own id of the post being replied to (X tweet id, Threads media id).
  postId: string;
  body: string;
}

// 'mention' = an @mention in our own new post. 'reply' = a reply to their existing post. Mirrors
// MessagingChannel's plain-TS/zod-enum duality (see artifact-schemas.ts's greetingAction).
export type GreetAction = 'mention' | 'reply';

export interface SocialAdapter {
  platform: SocialPlatform;
  // Which asset types this adapter can publish (FB: all; others added per phase).
  supports: AssetType[];
  publish(input: PublishInput): Promise<PublishResult>;
  // Mention/reply (Multi-channel Nurture Nodes Phase 02, ADDITIVE — `publish` is unchanged). A
  // platform that structurally can't do the action (no arbitrary reply-to-post; no text-only own
  // post) simply omits it — greetTo degrades to {ok:false,error:'unsupported'}, NEVER throws.
  mention?(input: MentionInput): Promise<PublishResult>;
  reply?(input: ReplyInput): Promise<PublishResult>;
}
