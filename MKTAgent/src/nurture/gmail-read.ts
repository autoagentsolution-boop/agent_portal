// Gmail READ client (Lead Nurture Agent Phase 02) — the net-new capability enabling two-way nurture.
// Reads ONLY a single, already-known Gmail conversation (`threads.get` by our stored gmailThreadId) —
// callers never list/search the owner's inbox (HARD invariant #2). Uses the SAME per-owner refresh
// token as Drive/gmail.send (drive-client.ts's driveAuthUrl now also requests gmail.readonly); a token
// minted before that scope existed simply fails these calls with an insufficient-scope error, which
// `hasGmailReadScope` turns into a clean boolean instead of a crash (HARD invariant #5).
import { google, type gmail_v1 } from 'googleapis';
import { env } from '../config/env.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import { DRIVE_REFRESH_KEY } from '../assets/drive-client.ts';
import { withRetry } from '../lib/retry.ts';

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string; // lowercased bare address (display name stripped)
  receivedAt: Date;
  bodyText: string;
  // Gmail applied the SENT label → this is OUR own outbound copy, not an inbound reply.
  isOutbound: boolean;
  // Auto-Submitted != no, or Precedence: bulk/list — a bounce/autoresponder/mailing-list notice.
  isAutoReply: boolean;
}

const clientFor = (refreshToken: string): gmail_v1.Gmail => {
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
};

const header = (headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | undefined =>
  headers?.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? undefined;

// `<Name> <addr@x.com>` → `addr@x.com`; a bare address passes through unchanged.
const extractEmail = (from: string | undefined): string => {
  const m = from?.match(/<([^>]+)>/);
  return (m?.[1] ?? from ?? '').trim().toLowerCase();
};

const decodeBase64Url = (data?: string | null): string => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

// Depth-first search for the first text/plain part (multipart messages nest parts recursively).
const findTextPlain = (part?: gmail_v1.Schema$MessagePart | null): string | null => {
  if (!part) return null;
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findTextPlain(child);
    if (found) return found;
  }
  return null;
};

const toGmailMessage = (m: gmail_v1.Schema$Message): GmailMessage | null => {
  if (!m.id || !m.threadId) return null;
  const headers = m.payload?.headers;
  const autoSubmitted = (header(headers, 'Auto-Submitted') ?? 'no').toLowerCase();
  const precedence = (header(headers, 'Precedence') ?? '').toLowerCase();
  return {
    id: m.id,
    threadId: m.threadId,
    from: extractEmail(header(headers, 'From')),
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
    bodyText: findTextPlain(m.payload) ?? decodeBase64Url(m.payload?.body?.data) ?? m.snippet ?? '',
    isOutbound: (m.labelIds ?? []).includes('SENT'),
    isAutoReply: autoSubmitted !== 'no' || precedence === 'bulk' || precedence === 'list',
  };
};

export type GmailListFn = (ownerId: string, threadId: string, since: Date | null) => Promise<GmailMessage[]>;

// List every message in ONE known Gmail conversation newer than `since` (null = the whole thread —
// the first-ever poll of a fresh nurture thread). Bounded to a single thread per call by construction
// (invariant #2) — the poller loops the owner's own nurtured threadIds, never a mailbox-wide search.
export const listThreadMessages: GmailListFn = async (ownerId, threadId, since) => {
  const refreshToken = await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY);
  if (!refreshToken) throw new Error('gmail_not_connected');
  const gmail = clientFor(refreshToken);
  const res = await withRetry(() => gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' }), {
    label: 'gmail_read_thread',
  });
  const messages = (res.data.messages ?? []).map(toGmailMessage).filter((m): m is GmailMessage => m !== null);
  return since ? messages.filter((m) => m.receivedAt.getTime() > since.getTime()) : messages;
};

// A 403 that names a scope/permission problem means the token predates gmail.readonly — a clean
// "not granted" the caller degrades on. Any OTHER error (network blip, 5xx) is rethrown so the poller
// can log it as transient rather than misreporting a working connection as scope-missing forever.
const isScopeError = (e: unknown): boolean => /insufficient|403|forbidden|permission/i.test(String(e instanceof Error ? e.message : e));

// Cheap probe for whether this owner's Gmail token currently carries a read-capable scope
// (gmail.readonly / gmail.modify / the full mail.google.com scope all satisfy getProfile).
// No token at all → definitely no read scope (false, not an error).
export const hasGmailReadScope = async (ownerId: string): Promise<boolean> => {
  const refreshToken = await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    await clientFor(refreshToken).users.getProfile({ userId: 'me' });
    return true;
  } catch (e) {
    if (isScopeError(e)) return false;
    throw e;
  }
};
