// Messaging-adapter contract (Multi-channel Nurture Nodes Phase 01) — mirrors SocialAdapter
// (src/social/types.ts) but for 1:1 OPT-IN direct messages, not the social publisher. `to` is the
// channel's own recipient address (E.164 phone for WhatsApp/Zalo, chat id for Telegram) — PLAINTEXT
// in memory, NEVER logged; opt-in-repo.ts is the only place it is encrypted for storage.
import { env } from '../config/env.ts';

export type MessagingChannel = 'whatsapp' | 'telegram' | 'zalo';

export interface DmSendInput {
  ownerId: string;
  to: string;
  body: string;
  // WhatsApp Cloud API requires a pre-approved TEMPLATE (name + params) to open a conversation
  // outside the 24h customer-service window. Optional so a plain body-only send still type-checks
  // for the other channels; unused by telegram/zalo today.
  templateName?: string | null;
  templateParams?: string[] | null;
}

export interface DmSendResult {
  ok: boolean;
  error: string | null;
  // The provider's message id (real send) or a synthetic `dryrun-...` id (DRY-RUN) — non-null on ok.
  platformMessageId: string | null;
  // true = simulated, no network call was made. Every adapter defaults to this — see isLiveDmSend.
  dryRun: boolean;
}

export interface DmAdapter {
  channel: MessagingChannel;
  send(input: DmSendInput): Promise<DmSendResult>; // never throws
  // Reads the LOCAL opt-in gate (opt-in-repo.ts) — none of these providers expose a queryable
  // opt-in-status API, so every adapter delegates to the same repo today. Kept per-adapter (mirrors
  // SocialAdapter's shape) so a future provider-side check could override it without an interface change.
  optInStatus(ownerId: string, to: string): Promise<'opted_in' | 'expired' | 'none'>;
}

// DM send seam threaded through RunnerContext (dm-runners.ts) — stubbed in verification so 0 real
// messages go out during a test run. Unset → sendDm's real registry dispatch, which is STILL DRY-RUN
// by default per isLiveDmSend (live only with an explicit token + the ENABLE_LIVE_DM_SEND flag).
export type DmSendFn = (channel: MessagingChannel, input: DmSendInput) => Promise<DmSendResult>;

// Fail-closed live-send gate (HARD invariant #1, feedback_no_burst_social_posts): a channel only
// attempts a REAL network send when its provider token is present AND the global off-by-default flag
// is explicitly on. Zalo additionally requires ENABLE_ZALO (deferred until ZNS template approval —
// plan phase-01 verdict). Missing/false anywhere in the chain → DRY-RUN, always.
export const isLiveDmSend = (channel: MessagingChannel, hasToken: boolean): boolean => {
  if (!hasToken || !env.ENABLE_LIVE_DM_SEND) return false;
  if (channel === 'zalo' && !env.ENABLE_ZALO) return false;
  return true;
};
