// Per-owner Gmail send (Atria v2 P2-2c — the Email Agent's delivery). Sends a nurture email FROM the
// owner's own Gmail using the Google refresh token minted by the Drive connect flow (now scoped with
// gmail.send too — decision 4: keep-Google, no third-party ESP). Distinct from leads/notify.ts, which
// notifies the SALES team from a SYSTEM env token; this sends to a LEAD from the TENANT's account.
import { google } from 'googleapis';
import { env } from '../config/env.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import { DRIVE_REFRESH_KEY } from '../assets/drive-client.ts';

// RFC 2822 message → base64url (Gmail API raw format). UTF-8 subject encoding so VN/diacritics
// survive the header. Shared with leads/notify.ts.
export const buildRaw = (to: string, subject: string, body: string): string => {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const mime = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
};

// Gmail is connected iff the owner holds the Google refresh token (same token as Drive). Whether that
// token actually carries the gmail.send scope is only knowable at send time — an old drive-only token
// fails loud there with a scope error the UI surfaces as "reconnect Google".
export const hasGmailConnected = async (ownerId: string): Promise<boolean> =>
  Boolean(await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY));

export interface SendResult { ok: boolean; id?: string; error?: string }

// Send one email as the owner. Best-effort result (never throws) so the route can return a clean
// error (e.g. insufficient scope → reconnect) instead of a 500. `sendFn` injectable for DRY verify.
export type GmailSendFn = (raw: string, ownerId: string) => Promise<{ id?: string | null }>;

const realSend: GmailSendFn = async (raw, ownerId) => {
  const refreshToken = await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY);
  if (!refreshToken) throw new Error('gmail_not_connected');
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: res.data.id };
};

export const sendGmailAs = async (
  ownerId: string,
  msg: { to: string; subject: string; body: string },
  sendFn: GmailSendFn = realSend,
): Promise<SendResult> => {
  try {
    const raw = buildRaw(msg.to, msg.subject, msg.body);
    const res = await sendFn(raw, ownerId);
    return { ok: true, id: res.id ?? undefined };
  } catch (e) {
    const raw = String(e instanceof Error ? e.message : e);
    // Google reports a missing scope as insufficient_scope / 403 — surface a reconnect hint.
    const scoped = /insufficient|scope|403|PERMISSION/i.test(raw);
    return { ok: false, error: scoped ? 'gmail_scope_missing' : raw.slice(0, 200) };
  }
};
