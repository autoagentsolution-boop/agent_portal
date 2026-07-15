// Per-owner Gmail send (Atria v2 P2-2c — the Email Agent's delivery). Sends a nurture email FROM the
// owner's own Gmail using the Google refresh token minted by the Drive connect flow (now scoped with
// gmail.send too — decision 4: keep-Google, no third-party ESP). Distinct from leads/notify.ts, which
// notifies the SALES team from a SYSTEM env token; this sends to a LEAD from the TENANT's account.
//
// Threading (Lead Nurture Agent Phase 02): every send carries its OWN generated RFC 5322 Message-ID
// (not Gmail's internal message id, which the send response doesn't expose without an extra read
// call) and optionally the prior touch's Message-ID as In-Reply-To/References + Gmail's own threadId
// — the combination Gmail (and any mail client) uses to collapse a conversation into one thread.
import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { env } from '../config/env.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import { DRIVE_REFRESH_KEY } from '../assets/drive-client.ts';

export interface RawMailOpts {
  messageId?: string;
  inReplyTo?: string | null;
  references?: string | null;
  // Nurture Inbox guardrails (Phase 04): a one-click unsubscribe target. RFC 2369 `List-Unsubscribe` is
  // what mail clients (Gmail included) use to render their own native "Unsubscribe" affordance next to
  // the sender — on top of the footer link ALREADY appended to the body by sendGmailAs below.
  listUnsubscribe?: string | null;
}

// RFC 2822 message → base64url (Gmail API raw format). UTF-8 subject encoding so VN/diacritics
// survive the header. Shared with leads/notify.ts (which calls the 3-arg form, no threading headers).
export const buildRaw = (to: string, subject: string, body: string, opts: RawMailOpts = {}): string => {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const headers = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    ...(opts.messageId ? [`Message-ID: ${opts.messageId}`] : []),
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    ...(opts.listUnsubscribe ? [`List-Unsubscribe: <${opts.listUnsubscribe}>`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ];
  return Buffer.from(headers.join('\r\n'), 'utf8').toString('base64url');
};

// Gmail is connected iff the owner holds the Google refresh token (same token as Drive). Whether that
// token actually carries the gmail.send scope is only knowable at send time — an old drive-only token
// fails loud there with a scope error the UI surfaces as "reconnect Google".
export const hasGmailConnected = async (ownerId: string): Promise<boolean> =>
  Boolean(await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY));

export interface SendResult { ok: boolean; id?: string; threadId?: string; messageId?: string; error?: string }

// Send one email as the owner. Best-effort result (never throws) so the route can return a clean
// error (e.g. insufficient scope → reconnect) instead of a 500. `sendFn` injectable for DRY verify.
// Returns Gmail's own `id` (internal message id) + `threadId` (conversation id) alongside `messageId`
// (the RFC Message-ID header WE generated and set — the id future replies thread against).
export type GmailSendFn = (
  raw: string,
  ownerId: string,
  threadId?: string,
) => Promise<{ id?: string | null; threadId?: string | null }>;

const realSend: GmailSendFn = async (raw, ownerId, threadId) => {
  const refreshToken = await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY);
  if (!refreshToken) throw new Error('gmail_not_connected');
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, ...(threadId ? { threadId } : {}) },
  });
  return { id: res.data.id, threadId: res.data.threadId };
};

export const sendGmailAs = async (
  ownerId: string,
  msg: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
    references?: string | null;
    threadId?: string | null;
    // Nurture Inbox guardrails (Phase 04): when set, this send is a NURTURE email — append a footer
    // unsubscribe line to the body AND set the List-Unsubscribe header. Callers outside the nurture
    // flow (the one-off Email Agent panel, a birthday/personal email) omit it, so this stays scoped to
    // nurture sends only, per the guardrail spec (not every email this function sends is a drip touch).
    unsubscribeUrl?: string | null;
  },
  sendFn: GmailSendFn = realSend,
): Promise<SendResult> => {
  try {
    // Our own domain-agnostic Message-ID — deterministic-shape, globally unique. Set on EVERY send
    // (even the first touch) so a later reply always has a concrete id to thread against.
    const messageId = `<${randomUUID()}@mktagent.local>`;
    const body = msg.unsubscribeUrl
      ? `${msg.body}\n\n—\nDon't want these emails? Unsubscribe: ${msg.unsubscribeUrl}`
      : msg.body;
    const raw = buildRaw(msg.to, msg.subject, body, {
      messageId,
      inReplyTo: msg.inReplyTo ?? undefined,
      references: msg.references ?? msg.inReplyTo ?? undefined,
      listUnsubscribe: msg.unsubscribeUrl ?? undefined,
    });
    const res = await sendFn(raw, ownerId, msg.threadId ?? undefined);
    return { ok: true, id: res.id ?? undefined, threadId: res.threadId ?? undefined, messageId };
  } catch (e) {
    const raw = String(e instanceof Error ? e.message : e);
    // Google reports a missing scope as insufficient_scope / 403 — surface a reconnect hint.
    const scoped = /insufficient|scope|403|PERMISSION/i.test(raw);
    return { ok: false, error: scoped ? 'gmail_scope_missing' : raw.slice(0, 200) };
  }
};
