// Social adapter registry. Scheduler fans out a post to each targeted platform
// by looking the adapter up here. Adapters added per phase (FB first).
import { facebookAdapter } from './facebook.ts';
import type { SocialAdapter, PublishInput, PublishResult } from './types.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

const registry: Partial<Record<SocialPlatform, SocialAdapter>> = {
  facebook: facebookAdapter,
  // instagram, threads, linkedin, x — added in later P2 steps.
};

export const getAdapter = (platform: SocialPlatform): SocialAdapter | undefined =>
  registry[platform];

// Publish one post to one platform. Unknown/unsupported → a failed PublishResult
// (never throws) so the scheduler aggregation stays uniform.
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
  return adapter.publish(input);
};

export type { PublishInput, PublishResult, SocialAdapter };
