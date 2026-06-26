// Social adapter contract. Ported verbatim from the n8n results[] invariant:
// every adapter returns PublishResult{platform,ok,url,error}; the scheduler
// aggregates these into posted|partial|error. Keeping the shape identical means
// the aggregation logic ports 1:1.
import type { SocialPlatform, AssetType } from '../../prisma/generated/prisma/client.ts';
import type { AssetRef } from '../assets/store.ts';

export interface PublishInput {
  postId: string;
  assetType: AssetType;
  // Resolved asset refs in display order (1 for image/video, 2-10 for carousel).
  assets: AssetRef[];
  // Copy variants — adapter picks the right one for its platform/length budget.
  copyVi: string;
  copyEn: string;
  copyThreads: string;
  copyX: string;
}

export interface PublishResult {
  platform: SocialPlatform;
  ok: boolean;
  url: string | null;
  error: string | null;
}

export interface SocialAdapter {
  platform: SocialPlatform;
  // Which asset types this adapter can publish (FB: all; others added per phase).
  supports: AssetType[];
  publish(input: PublishInput): Promise<PublishResult>;
}
