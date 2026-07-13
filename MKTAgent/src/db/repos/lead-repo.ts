// Lead repository — inbound leads + dedupe. TENANCY (T2): leads carry owner_id; dedupe is
// per-tenant. PII (§01.2): name/email/phone/message are AES-256-GCM encrypted at rest here (the
// single chokepoint) — callers pass/receive PLAINTEXT and never touch ciphertext. Dedupe runs on
// email_bidx (keyed HMAC of the email) since equality on ciphertext is impossible.
import { prisma } from '../client.ts';
import { encryptToken, decryptToken, blindIndex } from '../../lib/crypto.ts';
import type { Lead, LeadSource, Prisma } from '../../../prisma/generated/prisma/client.ts';
import type { ScoreReason } from '../../leads/scoring/rule-score.ts';

export interface CreateLeadInput {
  ownerId: string;
  name: string | null;
  email: string; // plaintext
  phone: string | null;
  message: string | null;
  sourceProduct: string | null;
  source: LeadSource;
  calBookingUid: string | null;
  score: number;
  scoreReasons: ScoreReason[];
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
  score: number | null;
  scoreReasons: ScoreReason[];
  receivedAt: Date;
  nurturedAt: Date | null; // last Email-Agent nurture send (P2-2c); null = never contacted
}

const enc = (v: string | null): string | null => (v && v.trim() ? encryptToken(v) : null);
const asReasons = (v: unknown): ScoreReason[] => (Array.isArray(v) ? (v as ScoreReason[]) : []);
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
  score: l.score,
  scoreReasons: asReasons(l.scoreReasons),
  receivedAt: l.receivedAt,
  nurturedAt: l.nurturedAt,
});

// Stamp a lead as nurtured (idempotency + audit for the Email Agent). Owner-scoped; returns whether
// a row was updated (false = wrong tenant / missing).
export const markLeadNurtured = async (id: string, ownerId: string): Promise<boolean> => {
  const r = await prisma.lead.updateMany({ where: { id, ownerId }, data: { nurturedAt: new Date() } });
  return r.count === 1;
};

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
      score: input.score,
      scoreReasons: input.scoreReasons as unknown as Prisma.InputJsonValue,
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

// REST list: tenant-scoped + keyset pagination by id. Fetches limit+1 rows so the
// router can compute nextCursor without a second count query (mirrors listPosts).
export interface ListLeadsArgs {
  ownerId: string;
  limit: number;
  cursor?: string;
}

export const listLeads = async (args: ListLeadsArgs): Promise<DecryptedLead[]> => {
  const rows = await prisma.lead.findMany({
    where: { ownerId: args.ownerId },
    orderBy: { receivedAt: 'desc' },
    take: args.limit + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
  });
  return rows.map(decryptLead);
};

// Owner-scoped fetch (decrypted) — for the rescore route. Null on miss/wrong-tenant.
export const getLead = async (id: string, ownerId: string): Promise<DecryptedLead | null> => {
  const row = await prisma.lead.findFirst({ where: { id, ownerId } });
  return row ? decryptLead(row) : null;
};

// Name/handle search for the Atria find_lead tool (P3). PII is encrypted at rest with no name blind
// index, so equality/contains can't run in SQL — fetch the owner's recent leads (bounded) and match in
// memory on DECRYPTED name+email. Token-AND: every query token must appear in name+email, so a follow-up
// like "Nghiep gmail" narrows a same-name collision by domain. Ranked name-first, higher-score leads tie-
// break. Owner-scoped. Returns top N decrypted leads (caller masks the email before it reaches the model).
export const searchLeadsByName = async (ownerId: string, q: string, limit = 5): Promise<DecryptedLead[]> => {
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}@._-]{2,}/gu) ?? []).slice(0, 6);
  if (!tokens.length) return [];
  const rows = await prisma.lead.findMany({ where: { ownerId }, orderBy: { receivedAt: 'desc' }, take: 500 });
  const scored = rows.map(decryptLead).map((l) => {
    const name = (l.name ?? '').toLowerCase();
    const email = l.email.toLowerCase();
    const hay = `${name} ${email}`;
    if (!tokens.every((t) => hay.includes(t))) return null;
    let score = 0;
    for (const t of tokens) {
      if (name === t) score += 100;
      else if (name.startsWith(t)) score += 60;
      else if (name.includes(t)) score += 40;
      else if (email.includes(t)) score += 20;
    }
    return { l, score };
  }).filter((x): x is { l: DecryptedLead; score: number } => x !== null);
  scored.sort((a, b) => b.score - a.score || (b.l.score ?? 0) - (a.l.score ?? 0));
  return scored.slice(0, limit).map((x) => x.l);
};

// Owner-scoped score write (rescore). Returns the updated decrypted lead, or null on miss.
export const updateLeadScore = async (
  id: string,
  ownerId: string,
  score: number,
  reasons: ScoreReason[],
): Promise<DecryptedLead | null> => {
  const r = await prisma.lead.updateMany({
    where: { id, ownerId },
    data: { score, scoreReasons: reasons as unknown as Prisma.InputJsonValue },
  });
  if (r.count !== 1) return null;
  return getLead(id, ownerId);
};
