// Greeting-adapter fan-out (Multi-channel Nurture Nodes Phase 02). Mirrors src/social/index.ts's
// publishTo, but for a public, person-directed GREETING (an @mention in our own new post, or a
// reply to their post) instead of a marketing publish. Reuses the SAME adapter registry + the SAME
// SocialPlatform tokens — no new credential surface.
//
// DRY-RUN by default (feedback_no_burst_social_posts): mention/reply are BRAND-NEW, never
// live-tested capabilities as of this phase. A tenant that already has a CONNECTED publish token
// must NOT silently start posting greetings the moment this ships — so a real network call only
// happens when ENABLE_LIVE_GREETING_SEND is explicitly on, on top of the adapter implementing the
// action. Off by default in every environment until deliberately flipped, post-validation.
import { getAdapter } from './index.ts';
import { env } from '../config/env.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';
import type { MentionInput, ReplyInput, PublishResult, GreetAction } from './types.ts';

export const isLiveGreetingSend = (): boolean => env.ENABLE_LIVE_GREETING_SEND;

// Greeting send seam threaded through RunnerContext.greetFn (agent-runners.ts) — stubbed in
// verification so 0 real posts go out. Unset → greetTo's real registry dispatch, which is STILL
// DRY-RUN by default per isLiveGreetingSend.
export type GreetFn = (
  platform: SocialPlatform,
  action: GreetAction,
  input: MentionInput | ReplyInput,
) => Promise<PublishResult>;

const unsupported = (platform: SocialPlatform): PublishResult => ({
  platform,
  ok: false,
  url: null,
  error: 'unsupported',
});

const dryRunResult = (platform: SocialPlatform): PublishResult => {
  const id = `dryrun-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Both `url` and `platformPostId` carry the synthetic id (mirrors a real publish()'s ok() shape,
  // which always sets both) — so a caller that persists only `url` (the external-action audit log's
  // `externalId` column) still has a non-null, stable identifier for the idempotency guard to key on.
  return { platform, ok: true, url: `dryrun://${id}`, error: null, platformPostId: id, dryRun: true };
};

// One greeting action to one platform. `greetFn` (verification seam) overrides dispatch entirely —
// a stub never reaches an adapter. Without it: an unknown platform / an action the adapter doesn't
// implement degrades FIRST (checked against the registry regardless of the live gate, so the
// degrade is provable without ever flipping ENABLE_LIVE_GREETING_SEND), THEN the live gate decides
// a real network call vs a simulated DRY-RUN success. Never throws — matches publishTo's contract.
export const greetTo = async (
  platform: SocialPlatform,
  action: GreetAction,
  input: MentionInput | ReplyInput,
  greetFn?: GreetFn,
): Promise<PublishResult> => {
  if (greetFn) return greetFn(platform, action, input);
  const adapter = getAdapter(platform);
  if (!adapter) return unsupported(platform);
  if (action === 'mention') {
    if (!adapter.mention) return unsupported(platform);
    if (!isLiveGreetingSend()) return dryRunResult(platform);
    return adapter.mention(input as MentionInput);
  }
  if (!adapter.reply) return unsupported(platform);
  if (!isLiveGreetingSend()) return dryRunResult(platform);
  return adapter.reply(input as ReplyInput);
};

export type { MentionInput, ReplyInput, GreetAction, PublishResult };
