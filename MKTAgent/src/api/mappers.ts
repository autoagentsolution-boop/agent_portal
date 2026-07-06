// DB row → API DTO. This is the decoupling boundary: the UI never sees Prisma
// types or Date objects, only the JSON-serializable DTO (dates as ISO strings).
// Change the DB shape freely as long as the mapper still produces the DTO.
import type { Campaign, Post } from '../../prisma/generated/prisma/client.ts';
import type { PostWithCampaign } from '../db/repos/post-repo.ts';
import type { CampaignDto, PostDto, PostDetailDto } from './schemas.ts';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const toCampaignDto = (c: Campaign): CampaignDto => ({
  id: c.id,
  flowId: c.flowId,
  product: c.product,
  angle: c.angle,
  brandContext: c.brandContext,
  leadsForm: c.leadsForm,
  active: c.active,
  language: c.language,
  defaultLength: c.defaultLength,
  platforms: c.platforms,
  brandVoice: c.brandVoice,
  postingWindow: c.postingWindow,
  timezone: c.timezone,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const toPostDto = (p: Post): PostDto => ({
  id: p.id,
  campaignId: p.campaignId,
  runId: p.runId,
  status: p.status,
  assetType: p.assetType,
  copy: (p.copy as PostDto['copy']) ?? null,
  language: p.language,
  lengthSpec: p.lengthSpec,
  angle: p.angle,
  brandVoice: p.brandVoice,
  feedback: p.feedback,
  driveFolderId: p.driveFolderId,
  heroFile: p.heroFile,
  platforms: p.platforms,
  platformAssets: (p.platformAssets as PostDto['platformAssets']) ?? null,
  productKnowledgeId: p.productKnowledgeId,
  referenceImage: p.referenceImage,
  leadCaptureKeyword: p.leadCaptureKeyword,
  leadCollectorStatus: p.leadCollectorStatus,
  leadCollectorExpiresAt: iso(p.leadCollectorExpiresAt),
  versionCount: p.versionCount,
  scheduledAt: iso(p.scheduledAt),
  postUrls: (p.postUrls as Record<string, string> | null) ?? null,
  error: p.error,
  postedAt: iso(p.postedAt),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toPostDetailDto = (p: PostWithCampaign): PostDetailDto => ({
  ...toPostDto(p),
  campaign: toCampaignDto(p.campaign),
});
