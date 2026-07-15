// Messaging-adapter registry (mirrors src/social/index.ts's publishTo fan-out) — routes a DM by
// channel to its adapter. One dm_writer/dm_agent node pair covers all 3 channels through this.
import { whatsappAdapter } from './whatsapp.ts';
import { telegramAdapter } from './telegram.ts';
import { zaloAdapter } from './zalo.ts';
import type { DmAdapter, DmSendInput, DmSendResult, DmSendFn, MessagingChannel } from './types.ts';

const registry: Record<MessagingChannel, DmAdapter> = {
  whatsapp: whatsappAdapter,
  telegram: telegramAdapter,
  zalo: zaloAdapter,
};

export const getDmAdapter = (channel: MessagingChannel): DmAdapter | undefined => registry[channel];

// Send one DM. `sendFn` (verification seam, threaded from RunnerContext.dmSendFn) overrides the
// registry entirely — a stub never reaches an adapter, so a test can assert failure/success without
// touching the DRY-RUN guard inside each adapter. Without it, dispatch goes to the real adapter,
// which is STILL DRY-RUN by default (isLiveDmSend) — no real message is ever sent by this call alone.
export const sendDm = async (
  channel: MessagingChannel,
  input: DmSendInput,
  sendFn?: DmSendFn,
): Promise<DmSendResult> => {
  if (sendFn) return sendFn(channel, input);
  const adapter = registry[channel];
  if (!adapter) return { ok: false, error: `no adapter for ${channel}`, platformMessageId: null, dryRun: true };
  return adapter.send(input);
};

export type { DmAdapter, DmSendInput, DmSendResult, DmSendFn, MessagingChannel };
