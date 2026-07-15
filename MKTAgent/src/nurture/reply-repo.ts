// InboundReply persistence (Lead Nurture Agent Phase 02). Body is AES-256-GCM ciphertext at rest —
// reuses lib/crypto.ts, the SAME envelope db/repos/lead-repo.ts uses for Lead PII (§01.2 pattern).
// Callers pass/receive PLAINTEXT; ciphertext never leaves this module. Ingestion is idempotent on
// gmailMessageId (@unique) — a re-poll of the same Gmail message across ticks is a safe no-op
// (HARD invariant #3), enforced here by catching the unique-violation rather than pre-checking (race-
// safe under overlapping poller ticks, mirrors nurture-thread-repo.enrollLead's P2002 handling).
import { prisma } from '../db/client.ts';
import { encryptToken, decryptToken } from '../lib/crypto.ts';
import type { InboundReply } from '../../prisma/generated/prisma/client.ts';

export interface UpsertReplyInput {
  threadId: string;
  gmailMessageId: string;
  fromEmail: string;
  body: string; // plaintext
  receivedAt: Date;
}

// Returns true iff a NEW row was created (false = already ingested — dedupe hit, not an error).
export const upsertInboundReply = async (input: UpsertReplyInput): Promise<boolean> => {
  try {
    await prisma.inboundReply.create({
      data: {
        threadId: input.threadId,
        gmailMessageId: input.gmailMessageId,
        fromEmail: input.fromEmail,
        // A reply can legitimately be body-less (e.g. an image-only click reply); never store '' —
        // encryptToken on an empty string is still valid ciphertext, so this is a style choice for
        // a readable decrypted value, not a correctness requirement.
        bodyEnc: encryptToken(input.body || '(no text body)'),
        receivedAt: input.receivedAt,
      },
    });
    return true;
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') return false;
    throw e;
  }
};

export interface DecryptedReply {
  id: string;
  threadId: string;
  fromEmail: string;
  body: string;
  receivedAt: Date;
  handled: boolean;
}

const decryptReply = (r: InboundReply): DecryptedReply => ({
  id: r.id,
  threadId: r.threadId,
  fromEmail: r.fromEmail,
  body: (() => {
    try {
      return decryptToken(r.bodyEnc);
    } catch {
      return ''; // tolerate a corrupt/legacy row rather than crash a read path
    }
  })(),
  receivedAt: r.receivedAt,
  handled: r.handled,
});

// Phase 03's brain consumes this — every reply on a thread the operator hasn't acted on yet, oldest
// first (chronological reading order for context).
export const listUnhandledReplies = async (threadId: string): Promise<DecryptedReply[]> =>
  (
    await prisma.inboundReply.findMany({ where: { threadId, handled: false }, orderBy: { receivedAt: 'asc' } })
  ).map(decryptReply);

export const markReplyHandled = async (id: string): Promise<void> => {
  await prisma.inboundReply.update({ where: { id }, data: { handled: true } });
};

// Every reply on a thread (any handled state), oldest first — the Nurture Inbox timeline (Phase 04).
// Distinct from listUnhandledReplies (Phase 03's brain input, handled:false only).
export const listRepliesForThread = async (threadId: string): Promise<DecryptedReply[]> =>
  (
    await prisma.inboundReply.findMany({ where: { threadId }, orderBy: { receivedAt: 'asc' } })
  ).map(decryptReply);
