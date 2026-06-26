// Campaign repository — top-level product/offer that spawns posts.
import { prisma } from '../client.ts';
import type { Campaign, Prisma } from '../../../prisma/generated/prisma/client.ts';

export const createCampaign = (data: Prisma.CampaignCreateInput): Promise<Campaign> =>
  prisma.campaign.create({ data });

export const getCampaign = (id: string): Promise<Campaign | null> =>
  prisma.campaign.findUnique({ where: { id } });

export const listCampaigns = (activeOnly = false): Promise<Campaign[]> =>
  prisma.campaign.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: { createdAt: 'desc' },
  });

export const updateCampaign = (
  id: string,
  data: Prisma.CampaignUpdateInput,
): Promise<Campaign> => prisma.campaign.update({ where: { id }, data });
