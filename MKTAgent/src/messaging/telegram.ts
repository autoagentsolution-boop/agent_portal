// Telegram Bot API adapter. Real send path is POST /bot{token}/sendMessage — DRY-RUN unless
// TELEGRAM_BOT_TOKEN is set AND ENABLE_LIVE_DM_SEND=true (isLiveDmSend). No bot token exists yet
// (2026-07), so this path is currently unreachable — the code is real, not a placeholder. `to` is the
// Telegram chat id captured by the /webhook/telegram opt-in intake when a user /start's the bot.
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { withRetry } from '../lib/retry.ts';
import { getOptInState } from './opt-in-repo.ts';
import { isLiveDmSend, type DmAdapter, type DmSendInput, type DmSendResult } from './types.ts';

const dryRun = (): DmSendResult => ({ ok: true, error: null, platformMessageId: `dryrun-tg-${randomUUID()}`, dryRun: true });

export const telegramAdapter: DmAdapter = {
  channel: 'telegram',
  async send(input: DmSendInput): Promise<DmSendResult> {
    const hasToken = Boolean(env.TELEGRAM_BOT_TOKEN);
    if (!isLiveDmSend('telegram', hasToken)) {
      // Never log `to` (the chat id doubles as a recipient identifier) — only whether a token exists.
      logger.info('telegram_dm_dry_run', { ownerId: input.ownerId, hasToken });
      return dryRun();
    }
    try {
      const res = await withRetry(
        () =>
          fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: input.to, text: input.body }),
          }),
        { label: 'telegram_dm' },
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
      if (!res.ok || !data.ok) return { ok: false, error: `telegram: ${res.status} ${(data.description ?? '').slice(0, 160)}`, platformMessageId: null, dryRun: false };
      return { ok: true, error: null, platformMessageId: data.result?.message_id != null ? String(data.result.message_id) : null, dryRun: false };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200), platformMessageId: null, dryRun: false };
    }
  },
  async optInStatus(ownerId, to) {
    return getOptInState(ownerId, 'telegram', to);
  },
};
