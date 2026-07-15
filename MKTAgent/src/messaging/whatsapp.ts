// WhatsApp Cloud API adapter (Meta Graph). Real send path is a template/text message (POST
// /{phoneNumberId}/messages) — DRY-RUN unless WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set
// AND ENABLE_LIVE_DM_SEND=true (isLiveDmSend). No live credentials exist yet (2026-07), so this path is
// currently unreachable in every deployment — the code is real, not a placeholder; flipping the two env
// vars is the only change needed to go live once a WhatsApp Business number is provisioned.
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { withRetry } from '../lib/retry.ts';
import { getOptInState } from './opt-in-repo.ts';
import { isLiveDmSend, type DmAdapter, type DmSendInput, type DmSendResult } from './types.ts';

const dryRun = (): DmSendResult => ({ ok: true, error: null, platformMessageId: `dryrun-wa-${randomUUID()}`, dryRun: true });

export const whatsappAdapter: DmAdapter = {
  channel: 'whatsapp',
  async send(input: DmSendInput): Promise<DmSendResult> {
    const hasToken = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
    if (!isLiveDmSend('whatsapp', hasToken)) {
      // Never log `to` (the plaintext phone number) — only that a DRY-RUN happened + whether a token
      // is configured, for operator visibility into why it's still simulated.
      logger.info('whatsapp_dm_dry_run', { ownerId: input.ownerId, hasToken });
      return dryRun();
    }
    try {
      const payload = input.templateName
        ? {
            messaging_product: 'whatsapp',
            to: input.to,
            type: 'template',
            template: {
              name: input.templateName,
              language: { code: 'en_US' },
              components: input.templateParams?.length
                ? [{ type: 'body', parameters: input.templateParams.map((p) => ({ type: 'text', text: p })) }]
                : undefined,
            },
          }
        : { messaging_product: 'whatsapp', to: input.to, type: 'text', text: { body: input.body } };
      const res = await withRetry(
        () =>
          fetch(`https://graph.facebook.com/${env.GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        { label: 'whatsapp_dm' },
      );
      const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: unknown };
      if (!res.ok) return { ok: false, error: `whatsapp: ${res.status} ${JSON.stringify(data).slice(0, 200)}`, platformMessageId: null, dryRun: false };
      return { ok: true, error: null, platformMessageId: data.messages?.[0]?.id ?? null, dryRun: false };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200), platformMessageId: null, dryRun: false };
    }
  },
  async optInStatus(ownerId, to) {
    return getOptInState(ownerId, 'whatsapp', to);
  },
};
