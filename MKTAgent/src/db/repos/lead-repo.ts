// Lead repository — inbound leads + dedupe queries (30d email / calcom uid).
// TENANCY (T2): leads carry owner_id directly. Dedupe is per-tenant — the same
// email reaching two different owners is two distinct leads, not a duplicate.
import { prisma } from '../client.ts';
import type { Lead, Prisma } from '../../../prisma/generated/prisma/client.ts';

// ownerId is part of UncheckedCreateInput → caller must supply it.
export const createLead = (data: Prisma.LeadUncheckedCreateInput): Promise<Lead> =>
  prisma.lead.create({ data });

// Dedupe: same email seen within `sinceDays` (default 30) FOR THIS OWNER.
export const isDuplicateByEmail = async (
  ownerId: string,
  email: string,
  sinceDays = 30,
): Promise<boolean> => {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
  const hit = await prisma.lead.findFirst({
    where: { ownerId, email: email.trim().toLowerCase(), receivedAt: { gte: cutoff } },
    select: { id: true },
  });
  return hit !== null;
};

// Cal.com dedupe: each booking uid = one lead per owner (survives webhook retries).
export const isDuplicateByBookingUid = async (
  ownerId: string,
  uid: string,
): Promise<boolean> => {
  if (!uid) return false;
  const hit = await prisma.lead.findFirst({
    where: { ownerId, calBookingUid: uid },
    select: { id: true },
  });
  return hit !== null;
};

export const listLeads = (ownerId: string, limit = 100): Promise<Lead[]> =>
  prisma.lead.findMany({ where: { ownerId }, orderBy: { receivedAt: 'desc' }, take: limit });
