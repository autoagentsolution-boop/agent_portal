// Zalo ZNS (Zalo Notification Service) adapter — VN-only, DEFERRED (plan phase-01 verdict 🟡): needs
// ZNS template approval from Zalo before any real send is possible. isLiveDmSend refuses a live send
// for this channel unless BOTH ENABLE_ZALO and ENABLE_LIVE_DM_SEND are true, on top of the token check
// here — so this stays DRY-RUN even if a ZALO_OA_ACCESS_TOKEN happens to be configured. The real send
// path is written (not a placeholder) so going live later is a flag flip, not a rewrite.
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { withRetry } from '../lib/retry.ts';
import { getOptInState } from './opt-in-repo.ts';
import { isLiveDmSend, type DmAdapter, type DmSendInput, type DmSendResult } from './types.ts';

const dryRun = (): DmSendResult => ({ ok: true, error: null, platformMessageId: `dryrun-zl-${randomUUID()}`, dryRun: true });

export const zaloAdapter: DmAdapter = {
  channel: 'zalo',
  async send(input: DmSendInput): Promise<DmSendResult> {
    const hasToken = Boolean(env.ZALO_OA_ACCESS_TOKEN && env.ZALO_TEMPLATE_ID);
    if (!isLiveDmSend('zalo', hasToken)) {
      // Never log `to` (the ZNS-eligible phone number) — only whether tokens/flags are configured.
      logger.info('zalo_dm_dry_run', { ownerId: input.ownerId, hasToken, enableZalo: env.ENABLE_ZALO });
      return dryRun();
    }
    try {
      const res = await withRetry(
        () =>
          fetch('https://business.openapi.zalo.me/message/template', {
            method: 'POST',
            headers: { access_token: env.ZALO_OA_ACCESS_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: input.to,
              template_id: input.templateName ?? env.ZALO_TEMPLATE_ID,
              template_data: input.templateParams?.length ? { body: input.templateParams.join(' ') } : { body: input.body },
            }),
          }),
        { label: 'zalo_dm' },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: number; message?: string; data?: { msg_id?: string } };
      if (!res.ok || (data.error && data.error !== 0)) return { ok: false, error: `zalo: ${(data.message ?? String(res.status)).slice(0, 200)}`, platformMessageId: null, dryRun: false };
      return { ok: true, error: null, platformMessageId: data.data?.msg_id ?? null, dryRun: false };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200), platformMessageId: null, dryRun: false };
    }
  },
  async optInStatus(ownerId, to) {
    return getOptInState(ownerId, 'zalo', to);
  },
};
