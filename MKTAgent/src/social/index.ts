// Social adapter registry. Scheduler fans out a post to each targeted platform
// by looking the adapter up here. Adapters added per phase (FB first).
import { facebookAdapter } from './facebook.ts';
import { instagramAdapter } from './instagram.ts';
import { threadsAdapter } from './threads.ts';
import { linkedinAdapter } from './linkedin.ts';
import { xAdapter } from './x.ts';
import { env } from '../config/env.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

const registry: Partial<Record<SocialPlatform, SocialAdapter>> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  threads: threadsAdapter,
  linkedin: linkedinAdapter,
  x: xAdapter,
};

export const getAdapter = (platform: SocialPlatform): SocialAdapter | undefined =>
  registry[platform];

// Master live-publish gate. ON by default (see env.ts) — flipping it off simulates the platform
// call so a flow can be driven end to end without posting to a connected page.
export const isLiveSocialPublish = (): boolean => env.ENABLE_LIVE_SOCIAL_PUBLISH;

// Simulated success, shaped exactly like a real adapter ok(): both `url` and `platformPostId` carry
// a synthetic id so a caller that persists only one of them still has a non-null, stable identifier
// for the idempotency guard. Shared with greeting.ts's DRY-RUN path.
export const dryRunResult = (platform: SocialPlatform): PublishResult => {
  const id = `dryrun-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { platform, ok: true, url: `dryrun://${id}`, error: null, platformPostId: id, dryRun: true };
};

// Publish one post to one platform. Unknown/unsupported → a failed PublishResult
// (never throws) so the scheduler aggregation stays uniform. The unsupported checks run BEFORE the
// live gate so an asset-type degrade stays provable without flipping the flag.
export const publishTo = async (
  platform: SocialPlatform,
  input: PublishInput,
): Promise<PublishResult> => {
  const adapter = registry[platform];
  if (!adapter) {
    return { platform, ok: false, url: null, error: `no adapter for ${platform}` };
  }
  if (!adapter.supports.includes(input.assetType)) {
    return { platform, ok: false, url: null, error: `${platform} does not support ${input.assetType}` };
  }
  if (!isLiveSocialPublish()) return dryRunResult(platform);
  return adapter.publish(input);
};

export type { PublishInput, PublishResult, SocialAdapter };
