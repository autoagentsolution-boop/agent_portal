// Lead repository — inbound leads + dedupe queries (30d email / calcom uid).
import { prisma } from '../client.ts';
import type { Lead, Prisma } from '../../../prisma/generated/prisma/client.ts';

export const createLead = (data: Prisma.LeadUncheckedCreateInput): Promise<Lead> =>
  prisma.lead.create({ data });

// Dedupe: same email seen within `sinceDays` (default 30). Mirrors n8n dedupe.
export const isDuplicateByEmail = async (
  email: string,
  sinceDays = 30,
): Promise<boolean> => {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
  const hit = await prisma.lead.findFirst({
    where: { email: email.trim().toLowerCase(), receivedAt: { gte: cutoff } },
    select: { id: true },
  });
  return hit !== null;
};

// Cal.com dedupe: each booking uid = one lead (survives webhook retries).
export const isDuplicateByBookingUid = async (uid: string): Promise<boolean> => {
  if (!uid) return false;
  const hit = await prisma.lead.findFirst({
    where: { calBookingUid: uid },
    select: { id: true },
  });
  return hit !== null;
};

export const listLeads = (limit = 100): Promise<Lead[]> =>
  prisma.lead.findMany({ orderBy: { receivedAt: 'desc' }, take: limit });
