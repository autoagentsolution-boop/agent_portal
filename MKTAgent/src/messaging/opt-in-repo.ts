// DM opt-in contact store + delivery-log (Multi-channel Nurture Nodes Phase 01). One DmContact row
// per (owner, channel, recipient) — externalId (phone / chat-id / handle) is AES-256-GCM ciphertext
// at rest (reuses lib/crypto.ts, the SAME envelope as Lead PII); externalIdBidx is its keyed HMAC so
// dm_agent's opt-in lookup can still run an equality query (ciphertext can't be, mirrors
// lead-repo.ts's emailBidx). Callers here pass/receive PLAINTEXT; ciphertext never leaves this file.
import { prisma } from '../db/client.ts';
import { encryptToken, decryptToken, blindIndex } from '../lib/crypto.ts';
import type { DmContact, DmMessage, MessagingChannel as PrismaChannel } from '../../prisma/generated/prisma/client.ts';
import type { MessagingChannel } from './types.ts';

const asChannel = (c: MessagingChannel): PrismaChannel => c as PrismaChannel;

// Opt-in gate READ (dm_agent's HARD invariant + every adapter's optInStatus). Unknown contact →
// 'none' (never sent to). No row is created here — a read must never have a write side-effect.
export const getOptInState = async (
  ownerId: string,
  channel: MessagingChannel,
  to: string,
): Promise<'opted_in' | 'expired' | 'none'> => {
  const row = await prisma.dmContact.findFirst({
    where: { ownerId, channel: asChannel(channel), externalIdBidx: blindIndex(to) },
    select: { optInState: true },
  });
  if (!row) return 'none';
  return row.optInState === 'opted_in' ? 'opted_in' : row.optInState === 'expired' ? 'expired' : 'none';
};

// Record a confirmed opt-in (Telegram /start webhook; a future WhatsApp/Zalo consent capture).
// Upserts on (owner, channel, recipient) so a re-opt-in (expired → active again) just refreshes the
// timestamp instead of creating a duplicate contact row.
export const recordOptIn = async (ownerId: string, channel: MessagingChannel, to: string): Promise<void> => {
  const bidx = blindIndex(to);
  const existing = await prisma.dmContact.findFirst({ where: { ownerId, channel: asChannel(channel), externalIdBidx: bidx } });
  if (existing) {
    await prisma.dmContact.update({ where: { id: existing.id }, data: { optInState: 'opted_in', optInAt: new Date() } });
  } else {
    await prisma.dmContact.create({
      data: { ownerId, channel: asChannel(channel), externalId: encryptToken(to), externalIdBidx: bidx, optInState: 'opted_in', optInAt: new Date() },
    });
  }
};

// Resolve (or create, state='none') the contact row a send/audit-trail attaches to. Creating a
// not-yet-opted-in row here is safe — the opt-in GATE is the separate getOptInState read the runner
// checks BEFORE ever reaching this; a 'none' contact row just means "we know of them, not opted in".
export const getOrCreateContactId = async (ownerId: string, channel: MessagingChannel, to: string): Promise<string> => {
  const bidx = blindIndex(to);
  const existing = await prisma.dmContact.findFirst({ where: { ownerId, channel: asChannel(channel), externalIdBidx: bidx } });
  if (existing) return existing.id;
  const row = await prisma.dmContact.create({
    data: { ownerId, channel: asChannel(channel), externalId: encryptToken(to), externalIdBidx: bidx, optInState: 'none' },
  });
  return row.id;
};

// Delivery-log idempotency (double-send guard): at most one DmMessage per run (schema unique on runId).
export const getDmMessageByRun = async (runId: string): Promise<DmMessage | null> =>
  prisma.dmMessage.findUnique({ where: { runId } });

export interface RecordDmMessageInput {
  ownerId: string;
  contactId: string;
  channel: MessagingChannel;
  runId: string;
  status: string; // sent | dry_run | error
  providerMessageId: string | null;
  body: string; // plaintext in — encrypted before storage
  error: string | null;
}

export const recordDmMessage = async (input: RecordDmMessageInput): Promise<DmMessage> =>
  prisma.dmMessage.create({
    data: {
      ownerId: input.ownerId,
      contactId: input.contactId,
      channel: asChannel(input.channel),
      runId: input.runId,
      direction: 'out',
      status: input.status,
      providerMessageId: input.providerMessageId,
      bodyEnc: encryptToken(input.body),
      error: input.error,
    },
  });

// Decrypt a contact's recipient address back to plaintext (audit/debug tooling only — never logged).
export const decryptContactAddress = (c: DmContact): string => {
  try { return decryptToken(c.externalId); } catch { return c.externalId; }
};
