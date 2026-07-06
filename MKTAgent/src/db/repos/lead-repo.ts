// Lead repository — inbound leads + dedupe. TENANCY (T2): leads carry owner_id; dedupe is
// per-tenant. PII (§01.2): name/email/phone/message are AES-256-GCM encrypted at rest here (the
// single chokepoint) — callers pass/receive PLAINTEXT and never touch ciphertext. Dedupe runs on
// email_bidx (keyed HMAC of the email) since equality on ciphertext is impossible.
import { prisma } from '../client.ts';
import { encryptToken, decryptToken, blindIndex } from '../../lib/crypto.ts';
import type { Lead, LeadSource } from '../../../prisma/generated/prisma/client.ts';

export interface CreateLeadInput {
  ownerId: string;
  name: string | null;
  email: string; // plaintext
  phone: string | null;
  message: string | null;
  sourceProduct: string | null;
  source: LeadSource;
  calBookingUid: string | null;
}

// A lead with PII decrypted back to plaintext — what read paths (list/DTO) work with.
export interface DecryptedLead {
  id: string;
  ownerId: string;
  name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  sourceProduct: string | null;
  source: LeadSource;
  calBookingUid: string | null;
  receivedAt: Date;
}

const enc = (v: string | null): string | null => (v && v.trim() ? encryptToken(v) : null);
const dec = (v: string | null): string | null => {
  if (!v) return null;
  try { return decryptToken(v); } catch { return v; } // tolerate a legacy plaintext row until backfilled
};

export const decryptLead = (l: Lead): DecryptedLead => ({
  id: l.id,
  ownerId: l.ownerId,
  name: dec(l.name),
  email: dec(l.email) ?? '',
  phone: dec(l.phone),
  message: dec(l.message),
  sourceProduct: l.sourceProduct,
  source: l.source,
  calBookingUid: l.calBookingUid,
  receivedAt: l.receivedAt,
});

export const createLead = async (input: CreateLeadInput): Promise<Lead> =>
  prisma.lead.create({
    data: {
      ownerId: input.ownerId,
      name: enc(input.name),
      email: encryptToken(input.email),
      emailBidx: blindIndex(input.email),
      phone: enc(input.phone),
      message: enc(input.message),
      sourceProduct: input.sourceProduct,
      source: input.source,
      calBookingUid: input.calBookingUid,
      // raw_payload intentionally NOT written (no-excess-storage §01.2).
    },
  });

// Dedupe: same email seen within `sinceDays` (default 30) FOR THIS OWNER, matched on the
// keyed blind index (ciphertext can't be equality-queried).
export const isDuplicateByEmail = async (ownerId: string, email: string, sinceDays = 30): Promise<boolean> => {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
  const hit = await prisma.lead.findFirst({
    where: { ownerId, emailBidx: blindIndex(email), receivedAt: { gte: cutoff } },
    select: { id: true },
  });
  return hit !== null;
};

// Cal.com dedupe: each booking uid = one lead per owner (survives webhook retries).
export const isDuplicateByBookingUid = async (ownerId: string, uid: string): Promise<boolean> => {
  if (!uid) return false;
  const hit = await prisma.lead.findFirst({ where: { ownerId, calBookingUid: uid }, select: { id: true } });
  return hit !== null;
};

export const listLeads = async (ownerId: string, limit = 100): Promise<DecryptedLead[]> => {
  const rows = await prisma.lead.findMany({ where: { ownerId }, orderBy: { receivedAt: 'desc' }, take: limit });
  return rows.map(decryptLead);
};
