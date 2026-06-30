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

// ---- CRUD bodies (T7) ----
// ownerId is NEVER accepted from the client — it is taken from the JWT. Post.copy
// and Post.status are owned by copy-gen/the review gate, so neither is settable here.

// Config-as-data fields are nullable: null = "clear / inherit from user default".
export const createCampaignBody = z.object({
  product: z.string().min(1).max(200),
  angle: z.string().max(2000).nullish(),
  brandContext: z.string().max(4000).nullish(),
  leadsForm: z.string().url().max(500).nullish(),
  active: z.boolean().optional(),
  language: z.string().max(40).nullish(),
  defaultLength: z.string().max(40).nullish(),
  platforms: z.array(socialPlatform).optional(),
  brandVoice: z.string().max(2000).nullish(),
  postingWindow: z.string().max(40).nullish(),
  timezone: z.string().max(64).nullish(),
});
export type CreateCampaignBody = z.infer<typeof createCampaignBody>;

// PATCH semantics: every field optional. `undefined` → unchanged; explicit `null`
// → clear the column. `.strict()` rejects unknown keys so typos surface as 422.
export const updateCampaignBody = createCampaignBody.partial().strict();
export type UpdateCampaignBody = z.infer<typeof updateCampaignBody>;

export const createPostBody = z.object({
  campaignId: z.string().uuid(),
  assetType: assetType.optional(),
  language: z.string().max(40).nullish(),
  lengthSpec: z.string().max(40).nullish(),
  driveFolderId: z.string().max(200).nullish(),
  heroFile: z.string().max(2000).nullish(), // 1 filename or CSV (carousel)
  platforms: z.array(socialPlatform).optional(),
  scheduledAt: z.coerce.date().nullish(),
});
export type CreatePostBody = z.infer<typeof createPostBody>;

// Editable post fields (campaignId is immutable — a re-home would desync ownerId).
export const updatePostBody = z
  .object({
    assetType,
    language: z.string().max(40).nullish(),
    lengthSpec: z.string().max(40).nullish(),
    driveFolderId: z.string().max(200).nullish(),
    heroFile: z.string().max(2000).nullish(),
    platforms: z.array(socialPlatform),
    scheduledAt: z.coerce.date().nullish(),
  })
  .partial()
  .strict();
export type UpdatePostBody = z.infer<typeof updatePostBody>;

// ---- Master Agent typed intake (draft-only, never publishes) -----------------------
export const agentIntakeBody = z.object({
  message: z.string().min(10).max(8000),
  timezone: z.string().max(64).default('Asia/Bangkok'),
});
export type AgentIntakeBody = z.infer<typeof agentIntakeBody>;

export const missingField = z.object({
  key: z.string(),
  label: z.string(),
  reason: z.string(),
  required: z.boolean(),
});
export type MissingField = z.infer<typeof missingField>;

export const agentPostDraft = z.object({
  assetType: assetType.optional(),
  language: z.string().nullable().optional(),
  lengthSpec: z.string().nullable().optional(),
  driveFolderId: z.string().nullable().optional(),
  heroFile: z.string().nullable().optional(),
  platforms: z.array(socialPlatform).optional(),
  // Draft responses are JSON; the create-post route will coerce this ISO string.
  scheduledAt: z.string().nullable().optional(),
});
export type AgentPostDraft = z.infer<typeof agentPostDraft>;

export const agentIntakeDraft = z.object({
  selectedTemplateId: z.literal('branding-video-post'),
  selectedTemplateTitle: z.literal('Branding / Social Video Post Flow'),
  confidence: z.number().min(0).max(1),
  campaign: createCampaignBody.partial().extend({ product: z.string().optional() }),
  post: agentPostDraft,
  missingFields: z.array(missingField),
  nextQuestion: z.string(),
  assistantMessage: z.string().optional(),
  provider: z.string(),
});
export type AgentIntakeDraft = z.infer<typeof agentIntakeDraft>;

export const createAgentChatBody = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(8000).optional(),
  timezone: z.string().max(64).default('Asia/Bangkok'),
});
export type CreateAgentChatBody = z.infer<typeof createAgentChatBody>;

export const appendAgentChatMessageBody = z.object({
  message: z.string().min(1).max(8000),
  timezone: z.string().max(64).default('Asia/Bangkok'),
});
export type AppendAgentChatMessageBody = z.infer<typeof appendAgentChatMessageBody>;

export const saveAgentCredentialBody = z.object({
  value: z.string().min(1).max(12000),
});
export type SaveAgentCredentialBody = z.infer<typeof saveAgentCredentialBody>;

// ---- Orchestration (Milestone 1: goal-based agent workflows) -----------------
// Request bodies + DTOs for /orchestration. The GoalSpec/WorkflowPlan internal Zod
// schemas live in src/orchestration/schemas; these are the API-boundary shapes.
export const createRunBody = z.object({
  message: z.string().min(3).max(8000),
  chatSessionId: z.string().uuid().optional(),
});
export type CreateRunBody = z.infer<typeof createRunBody>;

// Clarification answers: slot → value (string) or string[] for multi-select.
export const clarifyRunBody = z.object({
  answers: z.record(z.union([z.string(), z.array(z.string())])),
});
export type ClarifyRunBody = z.infer<typeof clarifyRunBody>;

// Save a planned run as a named Saved Flow (before execution).
export const saveRunBody = z.object({
  name: z.string().min(1).max(120),
});
export type SaveRunBody = z.infer<typeof saveRunBody>;

// Saved Flows list item — summary row for the sidebar + Active Flows list.
export const savedRunDto = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  status: z.string(),
  nodeCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedRunDto = z.infer<typeof savedRunDto>;

export const clarificationQuestionDto = z.object({
  slot: z.string(),
  question: z.string(),
  required: z.boolean(),
  choices: z.array(z.string()).optional(),
  multiSelect: z.boolean().optional(),
});

export const workflowNodeDto = z.object({
  nodeId: z.string(),
  agentId: z.string(),
  status: z.string(),
  dependsOn: z.array(z.string()),
  error: z.string().nullable(),
});

export const artifactDto = z.object({
  id: z.string().uuid(),
  nodeId: z.string(),
  type: z.string(),
  data: z.unknown(),
  createdAt: z.string(),
});

export const workflowRunDto = z.object({
  id: z.string().uuid(),
  status: z.string(),
  // User-given name once saved as a flow (Saved Flows); null while a draft run.
  name: z.string().nullable().optional(),
  goal: z.unknown(),
  plan: z.unknown().nullable(),
  // Chat session this run belongs to (M1 conversational unify) + the assistant's
  // natural-language reply for this turn. Both optional for forward-compat with rows
  // created before the conversational layer.
  chatSessionId: z.string().uuid().nullable().optional(),
  assistantMessage: z.string().optional(),
  questions: z.array(clarificationQuestionDto).optional(),
  nodes: z.array(workflowNodeDto),
  artifacts: z.array(artifactDto),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRunDto = z.infer<typeof workflowRunDto>;

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
