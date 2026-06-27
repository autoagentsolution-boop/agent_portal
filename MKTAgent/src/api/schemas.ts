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
export const leadSource = z.enum(['webhook', 'form', 'calcom']);

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
  // Config-as-data (T3) — all nullable (inherit from user / unset).
  language: z.string().nullable(),
  defaultLength: z.string().nullable(),
  platforms: z.array(socialPlatform),
  brandVoice: z.string().nullable(),
  postingWindow: z.string().nullable(),
  timezone: z.string().nullable(),
  createdAt: z.string(), // ISO
  updatedAt: z.string(),
});
export type CampaignDto = z.infer<typeof campaignDto>;

// Language-agnostic copy bag persisted to Post.copy (all variants in one language).
export const copyBag = z.object({
  body: z.string(),
  threads: z.string(),
  x: z.string(),
});
export type CopyBag = z.infer<typeof copyBag>;

export const postDto = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  status: postStatus,
  assetType,
  copy: copyBag.nullable(),
  language: z.string().nullable(),
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

// Lead read DTO (T6) — what GET /leads returns; rawPayload/ownerId never exposed.
export const leadDto = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  message: z.string().nullable(),
  sourceProduct: z.string().nullable(),
  source: leadSource,
  calBookingUid: z.string().nullable(),
  receivedAt: z.string(), // ISO
});
export type LeadDto = z.infer<typeof leadDto>;

// Lead intake bodies (T6). Webhook/form are open-shaped (funnels vary); documented
// as objects. Capture response is the dedupe outcome.
export const leadCaptureResult = z.object({
  status: z.enum(['created', 'duplicate', 'ignored']),
  leadId: z.string().uuid().nullable().optional(),
  reason: z.string().optional(),
});

// ---- Envelope: every response is { data } | { error }. Stable across the API. ----
export interface ListMeta {
  count: number;
  nextCursor: string | null;
}
