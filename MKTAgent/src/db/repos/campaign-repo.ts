// Campaign repository — top-level product/offer that spawns posts.
// TENANCY (T2): every read/write is scoped by ownerId. There is no unscoped
// findMany/findUnique — a missing ownerId is a compile error, not a silent leak.
import { prisma } from '../client.ts';
import type { Campaign, Prisma } from '../../../prisma/generated/prisma/client.ts';

export const createCampaign = (data: Prisma.CampaignUncheckedCreateInput): Promise<Campaign> =>
  prisma.campaign.create({ data });

// Ownership-scoped read: returns null for both "not found" and "wrong tenant"
// so the route maps either to 404 (no existence leak — plan §4).
export const getCampaign = (id: string, ownerId: string): Promise<Campaign | null> =>
  prisma.campaign.findFirst({ where: { id, ownerId } });

export const listCampaigns = (ownerId: string, activeOnly = false): Promise<Campaign[]> =>
  prisma.campaign.findMany({
    where: { ownerId, ...(activeOnly ? { active: true } : {}) },
    orderBy: { createdAt: 'desc' },
  });

// Scoped update via updateMany (where carries ownerId) → returns null if the
// guard didn't match (not found OR wrong tenant), letting the route return 404.
export const updateCampaign = async (
  id: string,
  ownerId: string,
  data: Prisma.CampaignUpdateInput,
): Promise<Campaign | null> => {
  const r = await prisma.campaign.updateMany({ where: { id, ownerId }, data });
  return r.count === 1 ? getCampaign(id, ownerId) : null;
};
