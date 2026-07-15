// Telegram /start opt-in intake (Multi-channel Nurture Nodes Phase 01) — INERT without a
// TELEGRAM_BOT_TOKEN (nothing is registered to call this until the bot's setWebhook is run), but the
// route itself is real, not a placeholder. Telegram calls this PUBLICLY (no JWT) for every update the
// bot receives; we only act on `/start` — the bot's own opt-in gesture. A user who hasn't started the
// bot can't message it, so `/start` IS the Telegram-equivalent of WhatsApp consent / a Zalo-eligible
// phone. Every other update is a fast 200 no-op (Telegram retries on anything else).
//
// Tenant resolution: messaging channel tokens are currently ENV-GLOBAL (no per-tenant messaging-connect
// flow exists yet, mirroring the legacy MKT_FB_PAGE_ACCESS_TOKEN pattern) — so, like the leads router's
// legacy-secret path, an opted-in contact lands on the SYSTEM owner until a per-tenant connect flow ships.
import { Router, type Request, type Response } from 'express';
import { safeEqual } from '../lib/crypto.ts';
import { env } from '../config/env.ts';
import { recordOptIn } from './opt-in-repo.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import { logger } from '../lib/logger.ts';

export const telegramWebhookRouter: Router = Router();

interface TelegramUpdate {
  message?: { chat?: { id?: number }; text?: string };
}

telegramWebhookRouter.post('/', async (req: Request, res: Response) => {
  // Verify Telegram's own secret token when configured (Bot API setWebhook `secret_token`) — an
  // unset TELEGRAM_WEBHOOK_SECRET accepts any caller (dev / not-yet-registered webhook; harmless
  // since nothing is wired to call this route without a bot token anyway).
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const presented = req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!safeEqual(presented, env.TELEGRAM_WEBHOOK_SECRET)) {
      res.status(401).json({ error: 'invalid_secret' });
      return;
    }
  }
  const update = (req.body ?? {}) as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? '').trim();
  if (chatId != null && text.startsWith('/start')) {
    await recordOptIn(SYSTEM_OWNER_ID, 'telegram', String(chatId)).catch((e) =>
      logger.warn('telegram_optin_failed', { error: String(e).slice(0, 160) }),
    );
  }
  // Telegram requires a fast 200 regardless of outcome, else it retries the same update.
  res.json({ ok: true });
});
