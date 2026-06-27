// API contract — Zod schemas are the SINGLE SOURCE OF TRUTH for the REST layer.
// Everything else derives from here: runtime validation (safeParse), TS types
// (z.infer), and later the OpenAPI spec (zod-to-openapi). UI consumes the DTO
// shapes; never hand-sync types across the boundary.
import { z } from 'zod';

// ---- Enums (mirror the Prisma enums; kept here so the API has no Prisma import) ----
export const postStatus = z.enum([
  'brief',
  'review',
  'rework',
  'ready',
  'posting',
  'posted',
  'partial',
  'error',
]);
export const assetType = z.enum(['image', 'carousel', 'video']);
export const socialPlatform = z.enum(['facebook', 'instagram', 'threads', 'linkedin', 'x']);

// ---- Query params ----
export const listPostsQuery = z.object({
  status: postStatus.optional(),
  campaignId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(), // keyset pagination by id
});
export type ListPostsQuery = z.infer<typeof listPostsQuery>;

// ---- Mutations (the review gate) ----
export const approvePostBody = z.object({
  // ISO 8601; UI sends an absolute instant. Optional → post immediately (now).
  scheduledAt: z.coerce.date().optional(),
});
export type ApprovePostBody = z.infer<typeof approvePostBody>;

export const rejectPostBody = z.object({
  feedback: z.string().min(1).max(2000),
});
export type RejectPostBody = z.infer<typeof rejectPostBody>;

// ---- Response DTOs (what the UI renders; decoupled from the DB row) ----
export const campaignDto = z.object({
  id: z.string().uuid(),
  product: z.string(),
  angle: z.string().nullable(),
  brandContext: z.string().nullable(),
  leadsForm: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(), // ISO
  updatedAt: z.string(),
});
export type CampaignDto = z.infer<typeof campaignDto>;

export const postDto = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  status: postStatus,
  assetType,
  copyVi: z.string().nullable(),
  copyEn: z.string().nullable(),
  copyThreads: z.string().nullable(),
  copyX: z.string().nullable(),
  lengthSpec: z.string().nullable(),
  feedback: z.string().nullable(),
  driveFolderId: z.string().nullable(),
  heroFile: z.string().nullable(),
  platforms: z.array(socialPlatform),
  scheduledAt: z.string().nullable(),
  postUrls: z.record(z.string()).nullable(),
  error: z.string().nullable(),
  postedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PostDto = z.infer<typeof postDto>;

// Detail view = post + embedded campaign (saves the UI a second round-trip).
export const postDetailDto = postDto.extend({ campaign: campaignDto });
export type PostDetailDto = z.infer<typeof postDetailDto>;

// ---- Envelope: every response is { data } | { error }. Stable across the API. ----
export interface ListMeta {
  count: number;
  nextCursor: string | null;
}
