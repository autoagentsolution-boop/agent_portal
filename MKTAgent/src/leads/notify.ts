// Sales notification on a new lead — best-effort Gmail send (ported from the n8n
// "Email Sales" node). NEVER throws into the capture path: the lead is already
// persisted, and a mail failure must not 500 the webhook (the funnel would retry
// → duplicate leads). Unconfigured (no creds / no recipient) → logged skip.
import { google } from 'googleapis';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { buildRaw } from '../email/gmail-send.ts';
import type { NormalizedLead } from './normalize.ts';

const isConfigured = (): boolean =>
  Boolean(
    env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REFRESH_TOKEN &&
      env.MKT_SALES_EMAIL,
  );

export const notifySales = async (lead: NormalizedLead): Promise<void> => {
  if (!isConfigured()) {
    logger.info('lead_notify_skipped', { reason: 'gmail_not_configured' });
    return;
  }
  try {
    const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth });

    const subject = `New lead: ${lead.sourceProduct || 'unknown'} via ${lead.sourcePlatform || 'unknown'}`;
    const body = [
      'New marketing lead received.',
      '',
      `Name: ${lead.name}`,
      `Email: ${lead.email ?? 'n/a (handle-only lead — captured via comment, no contact info given)'}`,
      `Phone: ${lead.phone}`,
      `Product: ${lead.sourceProduct}`,
      `Platform: ${lead.sourcePlatform}`,
      '',
      'Message:',
      lead.message,
    ].join('\n');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: buildRaw(env.MKT_SALES_EMAIL, subject, body) },
    });
    logger.info('lead_notify_sent', { to: env.MKT_SALES_EMAIL, email: lead.email });
  } catch (e) {
    // Swallow — capture already succeeded; surface for ops without failing the request.
    logger.warn('lead_notify_failed', { error: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
};
