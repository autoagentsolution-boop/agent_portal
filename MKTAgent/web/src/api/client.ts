// Typed fetch client for the MKTAgent API. Three jobs:
//   1. carry the HttpOnly session cookie on every call (credentials: 'include'),
//   2. unwrap the { data, meta } | { error, details } envelope into a Result,
//   3. centralize the API base so same-origin vs split-origin is one env var.
//
// Types come from src/api/schema.d.ts (generated from openapi.json — never
// hand-written). Run `npm run gen:types` after the contract changes.
import type { paths, components } from './schema';

// '' → same-origin (relative URLs); set VITE_API_BASE for split-origin dev.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export type Dto = components['schemas'];
export type CampaignDto = Dto['CampaignDto'];
// Product-knowledge analysis result (hand-written — route not in openapi yet).
export type ProductKnowledgeResult = {
  productDetails: string;
  profile: { productSummary: string; differentiators: string; targetAudience: string; proofPoints: string; brandVoice: string; language: string };
  brandVoice: string | null;
  language: string | null;
  cost: { promptTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  persistedToCampaign: boolean;
  library?: { id: string; name: string } | null;
};
export type UploadedDocInput = { name: string; mimeType: string; dataB64: string };
// Product Knowledge library entry (item 6; route not in openapi yet → hand-typed).
export type ProductKnowledgeEntry = {
  id: string;
  name: string;
  productDetails: string;
  profile: unknown;
  brandVoice: string | null;
  language: string | null;
  sourceDocs: string[];
  createdAt: string;
  updatedAt: string;
};
// versionCount / leadCollectorStatus / commentSourceIds — Lead Collector Phase 02/03 fields,
// live on the API but not yet in openapi.json/schema.d.ts (hand-typed at the boundary until regenerated).
// Optional so casts from narrower generated shapes (e.g. PostFromAgentDto['post']) stay valid.
// leadCollectorExpiresAt — Lead Collector Phase 04 field (set to now+30d on activate, refreshed
// by re-calling setCollector with the same keyword); not yet in openapi.json/schema.d.ts.
// Per-platform on-demand liveness check (§01.4 "Check links") — route not in openapi yet.
export type LinkStatusEntry = { platform: string; url: string; alive: boolean | null };
export type PostDto = Dto['PostDto'] & {
  versionCount?: number | null;
  leadCollectorStatus?: string | null;
  commentSourceIds?: Record<string, string> | null;
  leadCollectorExpiresAt?: string | null;
  // Persisted liveness snapshot (audit P0-3) so the Leads UI survives a refresh.
  linkStatus?: LinkStatusEntry[] | null;
};
export type PostDetailDto = Dto['PostDetailDto'];
export type LeadDto = Dto['LeadDto'];
// Lead Collector (§01) — routes not in openapi yet, hand-typed.
export type LeadScoreReason = { layer: 'rule' | 'llm'; reason: string; delta: number };
export type LeadRow = {
  id: string; name: string | null; email: string; phone: string | null; message: string | null;
  sourceProduct: string | null; source: 'webhook' | 'form' | 'calcom' | 'comment';
  calBookingUid: string | null; score: number | null; scoreReasons: LeadScoreReason[]; receivedAt: string;
};
export type IntakeTokenRow = { id: string; label: string | null; active: boolean; createdAt: string; lastUsedAt: string | null };
export type CreatedIntakeToken = { id: string; token: string; label: string | null; createdAt: string };
export type AgentIntakeDraft = {
  selectedTemplateId: 'branding-video-post';
  selectedTemplateTitle: 'Branding / Social Video Post Flow';
  confidence: number;
  campaign: Partial<Dto['CreateCampaignBody']>;
  post: Partial<Omit<Dto['CreatePostBody'], 'campaignId'>>;
  missingFields: Array<{ key: string; label: string; reason: string; required: boolean }>;
  nextQuestion: string;
  assistantMessage?: string;
  provider: string;
};
export type AgentChatMessageDto = { id: string; role: 'user' | 'agent'; content: string; createdAt: string };
export type AgentChatSessionDto = {
  id: string;
  title: string;
  draft: AgentIntakeDraft | null;
  createdAt: string;
  updatedAt: string;
  messages: AgentChatMessageDto[];
};

// Orchestration (M1 backbone) — the goal-based agent workflow surface.
export type WorkflowRunDto = Dto['WorkflowRunDto'];
export type SavedRunDto = Dto['SavedRunDto'];
// Connection Resolver output — connect/reconnect actions on a needs_connection run.
export type RequiredActionDto = NonNullable<WorkflowRunDto['requiredActions']>[number];

// Connections (M2-lite) — read-only social connection status.
export type ConnectionDto = Dto['ConnectionDto'];

// Phase 03 (safety/tiering/credits) — routes not in openapi yet, hand-typed at the boundary.
// Token/cost summary widened with the friendly `credits` number the backend now attaches to
// every run/flow/usage total (CostSummaryDto.credits). Structurally compatible with the
// generated WorkflowRunDto['cost']/['flowCost'] shape, so those can be passed in directly.
export interface CostSummary {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  credits?: number;
  runs?: number;
}
export type PlanTierId = 'economy' | 'balanced' | 'full';
export interface PlanTierEstimate {
  totalTokens: number;
  costUsd: number;
  credits: number;
  agentCount: number;
}
export interface PlanTier {
  id: PlanTierId;
  label: string;
  description: string;
  agentIds: string[];
  estimate: PlanTierEstimate;
  // Opaque server-side plan — the client never inspects it, only sends the tierId back.
  plan: unknown;
}
export interface UsageSurfaceTotal {
  surface: string;
  costUsd: number;
  totalTokens: number;
  // Share of costUsd from tokenless media rows (image/video/TTS bill USD, not tokens). Lets a surface
  // with high cost against few tokens read as media spend rather than a costing bug.
  mediaUsd: number;
  credits: number;
  calls: number;
}
// Charged vs absorbed spend (server: cost/spend-split.ts). Cost is fully transparent, so the report
// shows both halves rather than quietly netting them. Three things are absorbed, never billed:
// failed runs, node re-runs (policy (c), 2026-07-18 — revisit as tenant count grows), and off-run
// work like chat.
export interface SpendBucket {
  costUsd: number;
  totalTokens: number;
  credits: number;
}
export interface SpendSplit {
  charged: SpendBucket;
  absorbed: SpendBucket & { failedRuns: SpendBucket; reruns: SpendBucket; offRun: SpendBucket };
}
export interface UsageTotals {
  costUsd: number;
  totalTokens: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  credits: number;
  calls: number;
  bySurface: UsageSurfaceTotal[];
  split: SpendSplit;
}
export interface KillSwitchState {
  paused: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Agent registry as display data (command-center "Neural Network" view).
export type AgentGroupId = 'intelligence' | 'action' | 'assistant';
export interface AgentGroupDto {
  id: AgentGroupId;
  label: string;
  emoji: string;
  color: string;
}
export interface AgentNodeDto {
  id: string;
  name: string;
  description: string;
  emoji: string;
  group: AgentGroupId;
  vibe: string | null;
  // 'planned' = roadmap/vision agent, display-only (not runnable, not clickable).
  implStatus: 'live' | 'stub' | 'planned';
  // A vision agent that shipped a real Command-Center surface names its panel here (e.g. 'memory').
  // null for DAG agents and still-planned vision nodes.
  surface?: string | null;
  requiresConnection: boolean;
  requiresApproval: boolean;
}
export interface AgentCatalog {
  groups: AgentGroupDto[];
  agents: AgentNodeDto[];
}

// Publish review (item 3) — per-platform readiness for a post's assetType.
// Not yet in the generated openapi schema; typed here at the call boundary.
export interface PostabilityRowDto {
  platform: string;
  assetSupported: boolean;
  supportedAssetTypes: string[];
  connectionState: 'connected' | 'needs_attention' | 'not_connected';
  willPublish: boolean;
  reason: string | null;
}
export interface PostabilityDto {
  assetType: string;
  platforms: PostabilityRowDto[];
  publishable: string[];
  blocked: { platform: string; reason: string | null }[];
}

export interface ApiError {
  status: number;
  error: string;
  // i18n envelope (phase 02): structured params the client interpolates into the code's catalog
  // sentence. Optional + backward compatible — `error` stays a bare code string.
  params?: Record<string, string | number>;
  details?: unknown;
}

// Keyset-pagination envelope meta (mirrors backend ListMeta — src/api/schemas.ts). Callers that
// list a keyset-paginated endpoint (posts, leads) type `Result<T[], ListMeta>` to get `nextCursor`
// without every other `request<T>` call site having to know about pagination.
export interface ListMeta {
  count: number;
  nextCursor: string | null;
}

export type Result<T, M = unknown> = { ok: true; data: T; meta?: M } | { ok: false; error: ApiError };

// ---- Atria campaign-intelligence DTOs (Phases 02–07) --------------------------------------------
export type InstructionScope = 'workspace' | 'campaign' | 'post';
export interface InstructionDto {
  id: string;
  scope: InstructionScope;
  scopeRefId: string | null;
  agentId: string | null;
  content: string;
  enabled: boolean;
  source: 'user' | 'memory';
  createdAt: string;
  updatedAt: string;
}

export type SuggestionKind = 'plan_campaign' | 'repeat_winner' | 'roadmap_email' | 'roadmap_memory';
export interface AtriaSuggestion {
  kind: SuggestionKind;
  headline: string;
  rationale: string;
  rank: number;
  prefill: { intent?: string; product?: string; roadmapAgentId?: string };
}
export interface RoadmapAgentDto { id: string; name: string; whatItWouldDo: string; triggerSignal: string }

export type CalendarFormat = 'text' | 'image' | 'carousel' | 'video';
export interface CalendarSlotDto {
  index: number;
  pillar: string;
  angle: string;
  format: CalendarFormat;
  platforms: string[];
  hook: string;
  rationale: string;
  dayOffset: number;
}
export interface MaterializeResultDto {
  campaignId: string;
  swept: number;
  posts: Array<{ postId: string; runId: string; index: number; scheduledAt: string | null }>;
  skipped: Array<{ index: number; reason: string }>;
}
export type DerivedPostStatus = 'planned' | 'running' | 'held' | 'posted' | 'failed';
export interface CampaignStatusDto {
  campaignId: string;
  total: number;
  counts: Record<DerivedPostStatus, number>;
  posts: Array<{ postId: string; runId: string; status: DerivedPostStatus; scheduledAt: string | null }>;
}
// Workspace view-model (Atria v2 P0) — a Campaign reframed as an agent-room "Workspace". Routes
// (/workspaces) not in openapi yet → hand-typed at the boundary (same pattern as CampaignStatusDto).
export interface WorkspaceAgentCardDto {
  agentId: string;
  name: string;
  emoji: string;
  group: string | null;
  totalTokens: number;
  costUsd: number;
  credits: number;
  runs: number;
  completed: number;
  running: number;
  failed: number;
}
export interface WorkspaceSummaryDto {
  campaignId: string;
  name: string;
  product: string;
  active: boolean;
  platforms: string[];
  postCount: number;
  counts: Record<DerivedPostStatus, number>;
  costUsd: number;
  credits: number;
  updatedAt: string;
  chatSessionId: string | null;
}
export interface WorkspaceDetailDto extends WorkspaceSummaryDto {
  totalTokens: number;
  posts: CampaignStatusDto['posts'];
  agents: WorkspaceAgentCardDto[];
}

// Memory Agent (Atria v2 P2-2a) — learned copy-style loop. Routes (/memory) not in openapi yet.
export interface MemoryProposalDto { content: string; rationale: string; agentId: string }
export interface MemoryProposalsDto { editedCount: number; sampled: number; proposals: MemoryProposalDto[]; model: string | null }
export interface MemoryDto { id: string; agentId: string | null; content: string; enabled: boolean; createdAt: string }
// Slot facts (P5a) — what Atria remembers ABOUT the user (product/brand/audience/preference), distinct
// from the learned copy-style rules above.
export interface MemoryFactDto { id: string; kind: string; key: string | null; content: string; usedCount: number; updatedAt: string }

// Email Agent (Atria v2 P2-2c) — nurture captured leads via the owner's Gmail. Routes (/email) not in openapi.
export interface NurtureLeadDto { id: string; name: string | null; email: string; sourceProduct: string | null; score: number | null; nurturedAt: string | null }
export interface EmailDraftDto { leadId: string; to: string; subject: string; body: string }

// Nurture Inbox (Lead Nurture Agent Phase 04) — thread timeline + approve/edit/reject every pending
// touch/reply, manual controls, owner cadence settings. Routes (/nurture) not in openapi yet.
export interface NurtureThreadListDto {
  id: string;
  leadId: string;
  leadName: string | null;
  leadEmail: string | null;
  status: 'active' | 'paused' | 'converted' | 'opted_out' | 'completed' | 'failed';
  mode: 'drip' | 'conversation';
  touchNumber: number;
  nextPlanAt: string | null;
  hasUnhandledReply: boolean;
  needsHuman: boolean;
  updatedAt: string;
}
export interface NurtureTouchDto {
  id: string;
  index: number;
  stage: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  runId: string | null;
}
export interface NurtureReplyDto { id: string; fromEmail: string; body: string; receivedAt: string; handled: boolean }
export interface NurturePendingDraftDto {
  touchId: string;
  runId: string;
  gate: 'schedule' | 'send' | null;
  to: string[] | null;
  subject: string | null;
  body: string | null;
}
export interface NurtureThreadDetailDto extends NurtureThreadListDto {
  gmailThreadId: string | null;
  touches: NurtureTouchDto[];
  replies: NurtureReplyDto[];
  pendingDrafts: NurturePendingDraftDto[];
}
export interface NurtureSettingsDto { enabled: boolean; maxTouches: number; gapDays: number }

export interface CampaignCostEstimateDto { posts: number; agentCount: number; totalTokens: number; costUsd: number; credits: number }
export interface CampaignGrantResponse {
  campaignId: string;
  pendingConfirmation?: boolean;
  confirmationToken?: string;
  granted?: number;
  scheduleConfirmed?: boolean;
  estimate: CampaignCostEstimateDto;
  status: CampaignStatusDto;
}

// Per-post autonomy grant (mirrors CampaignGrantResponse, scoped to one post's run).
export interface PostGrantResponse {
  postId: string;
  pendingConfirmation?: boolean;
  confirmationToken?: string;
  granted?: boolean;
  scheduleConfirmed?: boolean;
  estimate: { totalTokens: number; costUsd: number; credits: number; agentCount: number };
}

export interface ImpactMetricsDto {
  postsPublished: number; postsTotal: number; platforms: string[]; mediaPieces: number;
  usdSpent: number; totalTokens: number; creditsSpent: number; leadsCaptured: number; runMinutes: number;
  // MEASURED social Insights (P2-2b: FB Page + IG Media) — a field is null when no platform measured it
  // (→ report uses the estimate). insightsPlatforms names who contributed (e.g. ['facebook','instagram']).
  measuredReach: number | null; measuredImpressions: number | null; measuredEngaged: number | null;
  postsMeasured: number; insightsPlatforms: string[];
}
export interface ImpactValueDto {
  estimated: true; baselineUsd: number; freelancerUsd: number; baselineDays: number;
  savedUsd: number; savedDays: number; estimatedReach: number;
  assumptions: Record<string, number>;
}
export interface ImpactReportDto {
  scope: 'campaign' | 'period';
  metrics: ImpactMetricsDto;
  value: ImpactValueDto;
  headline: string;
  creditsSpent: number;
  period?: string;
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

// Raised by the caller-facing helpers; the App catches 401 to bounce to login.
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

async function request<T, M = unknown>(path: string, opts: RequestOpts = {}): Promise<Result<T, M>> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      credentials: 'include', // send the session cookie cross-origin
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return { ok: false, error: { status: 0, error: 'network_error', details: String(e) } };
  }

  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 204) return { ok: true, data: undefined as T };

  const json = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: (json as { data: T }).data, meta: (json as { meta?: M }).meta };
  return {
    ok: false,
    error: {
      status: res.status,
      error: (json as { error?: string }).error ?? 'error',
      params: (json as { params?: Record<string, string | number> }).params,
      details: (json as { details?: unknown }).details,
    },
  };
}

// ---- Endpoint helpers (thin, typed) --------------------------------------------
// isSuperAdmin + credits (remaining wallet balance) are credit-wallet Phase 02 fields, live on /auth/me
// but not yet in the generated openapi schema → hand-widened at the boundary (same pattern as PostDto).
export type Me = NonNullable<
  paths['/auth/me']['get']['responses']['200']['content']['application/json']['data']
> & { isSuperAdmin?: boolean; credits?: number; uiLanguage?: string | null };

// Super-admin console (credit-wallet Phase 03) — routes not in openapi, hand-typed.
export interface TenantBalanceDto {
  ownerId: string;
  email: string;
  displayName: string | null;
  isSuperAdmin: boolean;
  balance: number;
  granted: number;
  spent: number;
  lastActive: string;
}
export interface CapabilityRequestDto {
  capabilityId: string;
  requests: number;
  tenants: number;
  exampleTask: string | null;
  spec: unknown | null;
  firstSeen: string;
  lastSeen: string;
}

// Provider spend = what WE pay Google, NOT tenant credits. No "remaining balance" field exists
// because no API exposes the Gemini prepaid balance, and costUsd is our price-table estimate
// recorded at call time, not Google's invoice.
export interface SpendBucketDto { calls: number; costUsd: number }
export interface SpendSliceDto { key: string; calls: number; costUsd: number }
export interface ProviderSpendDto {
  windows: { last24h: SpendBucketDto; last7d: SpendBucketDto; last30d: SpendBucketDto; lifetime: SpendBucketDto };
  bySurface: SpendSliceDto[];
  byModel: SpendSliceDto[];
  daily: Array<{ day: string; calls: number; costUsd: number }>;
  generatedAt: string;
}

export const api = {
  me: () => request<Me>('/auth/me'),
  // Interface language (i18n). Content language (defaultLanguage) is set elsewhere — these are distinct.
  setUiLanguage: (uiLanguage: string) => request<{ uiLanguage: string | null }>('/auth/me', { method: 'PATCH', body: { uiLanguage } }),
  logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),

  // ---- Super-admin console (credit-wallet Phase 03) — 404 for non-admins ----
  adminTenants: () => request<TenantBalanceDto[]>('/admin/tenants'),
  adminGrant: (ownerId: string, credits: number, reason?: string) =>
    request<{ ownerId: string; granted: number; balanceBefore: number; balance: number }>(
      '/admin/grant', { method: 'POST', body: { ownerId, credits, ...(reason ? { reason } : {}) } },
    ),
  adminCapabilityRequests: () => request<CapabilityRequestDto[]>('/admin/capability-requests'),
  adminProviderSpend: () => request<ProviderSpendDto>('/admin/provider-spend'),

  parseMasterIntake: (message: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) =>
    request<AgentIntakeDraft>('/agent/intake', { method: 'POST', body: { message, timezone } }),
  listAgentChats: () => request<AgentChatSessionDto[]>('/agent/chats'),
  createAgentChat: (title: string, message?: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) =>
    request<AgentChatSessionDto>('/agent/chats', { method: 'POST', body: { title, message, timezone } }),
  getAgentChat: (id: string) => request<AgentChatSessionDto>(`/agent/chats/${id}`),
  appendAgentChatMessage: (id: string, message: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) =>
    request<AgentChatSessionDto>(`/agent/chats/${id}/messages`, { method: 'POST', body: { message, timezone } }),
  deleteAgentChat: (id: string) => request<void>(`/agent/chats/${id}`, { method: 'DELETE' }),

  analyzeProductKnowledge: (
    files: UploadedDocInput[],
    opts?: { product?: string; campaignId?: string; saveToLibrary?: boolean; libraryName?: string; productKnowledgeId?: string },
  ) =>
    request<ProductKnowledgeResult>('/product-knowledge/analyze', { method: 'POST', body: { files, ...(opts ?? {}) } }),
  // Extract raw text from uploaded document(s)/image(s) so the user can UPLOAD a large file to summarize
  // instead of pasting it. The chat then proposes a summarize task on the returned text (Data Guard masks
  // any personal/sensitive data before summarizing).
  extractDocumentText: (files: UploadedDocInput[]) =>
    request<{ text: string; chars: number; names: string[] }>('/product-knowledge/extract-text', { method: 'POST', body: { files } }),
  // Summarize an uploaded document — bypasses the chat brain (raw PII would trip its safety filter). Builds
  // the security (Data Guard) → summarize run directly; returns the planned run DTO for the plan card.
  summarizeFile: (text: string, filename?: string, chatSessionId?: string) =>
    request<WorkflowRunDto>('/orchestration/summarize-file', { method: 'POST', body: { text, filename, chatSessionId } }),
  listProductKnowledge: () => request<ProductKnowledgeEntry[]>('/product-knowledge'),
  updateProductKnowledge: (id: string, body: { name?: string; productDetails?: string; brandVoice?: string | null; language?: string | null }) =>
    request<ProductKnowledgeEntry>(`/product-knowledge/${id}`, { method: 'PATCH', body }),
  deleteProductKnowledge: (id: string) => request<void>(`/product-knowledge/${id}`, { method: 'DELETE' }),
  listCampaigns: () => request<CampaignDto[]>('/campaigns'),
  getCampaign: (id: string) => request<CampaignDto>(`/campaigns/${id}`),
  // Lead Collector (§01) — keyset-paginated (mirrors listPosts); pass cursor=meta.nextCursor
  // from the previous page to fetch the next one.
  listLeads: (query?: { limit?: number; cursor?: string }) =>
    request<LeadRow[], ListMeta>('/leads', { query }),
  rescoreLead: (id: string) => request<LeadRow>(`/leads/${id}/rescore`, { method: 'POST' }),
  pollComments: () => request<{ postsPolled: number; commentsScanned: number; leadsCaptured: number; duplicates: number }>('/leads/poll-comments', { method: 'POST' }),
  listIntakeTokens: () => request<IntakeTokenRow[]>('/leads/intake-tokens'),
  // Start/stop a post's comment-keyword lead collector. On an already-published post, setting a
  // keyword also backfills its comment watch sources so it starts collecting immediately.
  setCollector: (id: string, keyword: string | null) =>
    request<PostDto>(`/posts/${id}/collector`, { method: 'POST', body: { keyword } }),
  // On-demand per-platform liveness check for a post's published links (real API calls — slow,
  // call from a button not on load). Backend self-heals: a dead watched source is dropped, and
  // an all-dead post flips to post_deleted (already filtered out of the collectors list).
  checkLinks: (id: string) => request<{ links: LinkStatusEntry[] }>(`/posts/${id}/link-status`),
  createIntakeToken: (label?: string) => request<CreatedIntakeToken>('/leads/intake-tokens', { method: 'POST', body: label ? { label } : {} }),
  revokeIntakeToken: (id: string) => request<void>(`/leads/intake-tokens/${id}`, { method: 'DELETE' }),
  createCampaign: (body: Dto['CreateCampaignBody']) =>
    request<CampaignDto>('/campaigns', { method: 'POST', body }),
  updateCampaign: (id: string, body: Dto['UpdateCampaignBody']) =>
    request<CampaignDto>(`/campaigns/${id}`, { method: 'PATCH', body }),
  deleteCampaign: (id: string) => request<void>(`/campaigns/${id}`, { method: 'DELETE' }),

  listPosts: (query?: { status?: string; campaignId?: string; limit?: number; cursor?: string }) =>
    request<PostDto[], ListMeta>('/posts', { query }),
  getPost: (id: string) => request<PostDetailDto>(`/posts/${id}`),
  getPostability: (id: string) => request<PostabilityDto>(`/posts/${id}/postability`),
  createPost: (body: Dto['CreatePostBody']) => request<PostDto>('/posts', { method: 'POST', body }),
  // Agent-authored create (item 3): the Master Agent extracts the brief from a free-text
  // description so the user never hand-fills the form. First call may return `questions`
  // (the agent needs more info); passing `answers` on the second call creates the post
  // (`post` + `filled` — the fields it captured).
  createPostFromAgent: (campaignId: string, message: string, answers?: Record<string, string | string[]>, productKnowledgeId?: string | null) =>
    request<Dto['PostFromAgentDto']>('/posts/from-agent', { method: 'POST', body: { campaignId, message, ...(answers ? { answers } : {}), ...(productKnowledgeId ? { productKnowledgeId } : {}) } }),
  // versionCount not yet in the generated UpdatePostBody — hand-typed alongside it.
  updatePost: (id: string, body: Dto['UpdatePostBody'] & { versionCount?: number }) =>
    request<PostDto>(`/posts/${id}`, { method: 'PATCH', body }),
  deletePost: (id: string) => request<void>(`/posts/${id}`, { method: 'DELETE' }),

  generate: (id: string) => request<PostDto>(`/posts/${id}/generate`, { method: 'POST' }),
  refine: (id: string, instruction: string) =>
    request<PostDto>(`/posts/${id}/refine`, { method: 'POST', body: { instruction } }),
  // Manual hand-edit of the copy (no LLM). Lands the post back at review.
  editCopy: (id: string, copy: { body: string; threads: string; x: string }) =>
    request<PostDto>(`/posts/${id}/edit-copy`, { method: 'POST', body: copy }),
  selectVariant: (id: string, index: number) =>
    request<PostDto>(`/posts/${id}/select-variant`, { method: 'POST', body: { index } }),
  uploadReferenceImage: (id: string, dataB64: string, mimeType: string, asHero?: boolean) =>
    request<PostDto>(`/posts/${id}/reference-image`, { method: 'POST', body: { dataB64, mimeType, ...(asHero ? { asHero: true } : {}) } }),
  deleteReferenceImage: (id: string) =>
    request<PostDto>(`/posts/${id}/reference-image`, { method: 'DELETE' }),
  approve: (id: string, scheduledAt?: string) =>
    request<PostDto>(`/posts/${id}/approve`, { method: 'POST', body: scheduledAt ? { scheduledAt } : {} }),
  reject: (id: string, feedback: string) =>
    request<PostDto>(`/posts/${id}/reject`, { method: 'POST', body: { feedback } }),
  publishNow: (id: string) => request<PostDto>(`/posts/${id}/publish-now`, { method: 'POST' }),

  // ---- Orchestration (M1 goal-based agent workflows) ----
  createRun: (message: string, chatSessionId?: string, opts?: { voice?: boolean; refine?: boolean }) =>
    request<WorkflowRunDto>('/orchestration/runs', { method: 'POST', body: { message, ...(chatSessionId ? { chatSessionId } : {}), ...(opts?.voice ? { voice: true } : {}), ...(opts?.refine ? { refine: true } : {}) } }),
  clarifyRun: (id: string, answers: Record<string, string | string[]>) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/clarify`, { method: 'POST', body: { answers } }),
  // Save a planned run as a named Saved Flow (chat "Approve" → name + redirect).
  saveRun: (id: string, name: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/save`, { method: 'POST', body: { name } }),
  // Rename an existing saved flow (any status) — inline rename in SavedFlowDetail.
  renameRun: (id: string, name: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}`, { method: 'PATCH', body: { name } }),
  // Execute a saved/planned flow (async — returns running immediately; SSE drives the DAG).
  // opts.autoPublish (UI toggle, default OFF server-side) publishes without the approval gate; when
  // omitted the executor falls back to the goal's NL flag (Atria honoring "đăng luôn") else the gate.
  executeRun: (id: string, opts?: { autoPublish?: boolean }) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/execute`, { method: 'POST', body: opts ?? {} }),
  // Test-run a saved flow (template) — clones it into a runnable instance server-side. Returns the
  // INSTANCE run (open THAT, not the template). Fixes the "Run a test post" 409 on a saved template.
  testRunFlow: (id: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/test-run`, { method: 'POST' }),
  // approve-node optionally carries a future scheduledAt (publish gate schedule picker): the post
  // parks `ready` and the scheduler publishes it at that time instead of publishing inline now.
  approveRunNode: (id: string, nodeId: string, scheduledAt?: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/approve-node/${nodeId}`, { method: 'POST', body: scheduledAt ? { scheduledAt } : {} }),
  rerunRunNode: (id: string, nodeId: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/rerun-node/${nodeId}`, { method: 'POST' }),
  getRun: (id: string) => request<WorkflowRunDto>(`/orchestration/runs/${id}`),
  // History restore: latest run behind a chat session (404 → chat has no run).
  getRunByChat: (chatSessionId: string) => request<WorkflowRunDto>(`/orchestration/runs/by-chat/${chatSessionId}`),
  listRuns: () => request<Array<{ id: string; status: string; createdAt: string; updatedAt: string }>>('/orchestration/runs'),
  // Saved Flows (named runs) for the sidebar + Active Flows surface.
  listSavedRuns: () => request<SavedRunDto[]>('/orchestration/runs/saved'),
  listResumableRuns: () => request<Array<{ id: string; name: string | null; status: string; chatSessionId: string | null; updatedAt: string }>>('/orchestration/runs/resumable'),
  deleteRun: (id: string) => request<void>(`/orchestration/runs/${id}`, { method: 'DELETE' }),

  // Generic scheduler (2026-07-12): parked runs (status='scheduled') queued for a timed re-entry, plus
  // cancel + reschedule. Timezone/phrase come from the run's confirmed schedule; resumeAt is UTC.
  listScheduledRuns: () =>
    request<Array<{ id: string; name: string | null; resumeAt: string | null; timezone: string | null; phrase: string | null; action: string | null; createdAt: string }>>('/orchestration/runs/scheduled'),
  cancelSchedule: (id: string) => request<WorkflowRunDto>(`/orchestration/runs/${id}/cancel-schedule`, { method: 'POST' }),
  reschedule: (id: string, scheduledAt: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/reschedule`, { method: 'POST', body: { scheduledAt } }),

  // ---- Phase 03: plan tiers, kill switch, usage dashboard ----
  // Checkpoint 2 — Economy/Balanced/Full variants for a `planned` run's goal (read-only
  // preview; [] when the goal can't be tiered, caller keeps the single-plan flow).
  getPlanTiers: (runId: string) => request<{ tiers: PlanTier[] }>(`/orchestration/runs/${runId}/plan-tiers`),
  // Rebuild the run's plan from a chosen tier. 409 run_not_retierable once running/completed;
  // 422 tier_unavailable if the tier isn't offered for this goal.
  applyTier: (runId: string, tierId: PlanTierId) =>
    request<WorkflowRunDto>(`/orchestration/runs/${runId}/apply-tier`, { method: 'POST', body: { tierId } }),
  // Kill switch — stop a single run at the next node boundary. 409 run_terminal if already done.
  abortRun: (runId: string) => request<{ id: string; status: string }>(`/orchestration/runs/${runId}/abort`, { method: 'POST' }),
  // Kill switch — global pause on every external action (publishes/outbound writes), workspace-wide.
  getKillSwitch: () => request<KillSwitchState>('/orchestration/killswitch'),
  setKillSwitch: (paused: boolean) => request<KillSwitchState>('/orchestration/killswitch', { method: 'POST', body: { paused } }),
  // Per-owner spend total + per-surface breakdown (chat/intake/copygen/research/... ) for the
  // usage dashboard.
  getUsage: () => request<UsageTotals>('/orchestration/usage'),

  // Agent registry (groups + nodes) for the command-center Neural Network view.
  getAgents: () => request<AgentCatalog>('/orchestration/agents'),

  // ---- Connections (M2-lite) ----
  listConnections: () => request<ConnectionDto[]>('/connections'),
  // Media storage targets (Drive is not a SocialPlatform → reported separately).
  storageStatus: () =>
    request<{ local: { connected: boolean }; drive: { connected: boolean; connectPath: string } }>(
      '/connections/storage',
    ),
  // Store a platform credential (OAuth-less form path) encrypted in the vault under
  // the publisher agent. Value is write-only — never read back.
  savePublisherCredential: (key: string, value: string) =>
    request<{ key: string; status: string; verify?: { alive: boolean; reason?: string; identity?: string } }>(
      `/agent/credentials/publisher/${key}`,
      { method: 'PUT', body: { value } },
    ),
  listPublisherCredentialKeys: () =>
    request<Array<{ agentId: string; key: string; status: string }>>('/agent/credentials/status'),

  // ---- Atria: user instructions (Phase 02) ----
  listInstructions: (scope?: InstructionScope, refId?: string) =>
    request<InstructionDto[]>('/instructions', { query: { scope, refId } }),
  createInstruction: (body: { scope: InstructionScope; scopeRefId?: string | null; agentId?: string | null; content: string; enabled?: boolean }) =>
    request<InstructionDto>('/instructions', { method: 'POST', body }),
  updateInstruction: (id: string, body: { content?: string; enabled?: boolean; agentId?: string | null }) =>
    request<InstructionDto>(`/instructions/${id}`, { method: 'PATCH', body }),
  deleteInstruction: (id: string) => request<void>(`/instructions/${id}`, { method: 'DELETE' }),

  // ---- Atria: proactive suggestions + roadmap (Phase 06) ----
  atriaSuggestions: () => request<AtriaSuggestion[]>('/atria/suggestions'),
  atriaRoadmap: () => request<RoadmapAgentDto[]>('/atria/roadmap'),
  acceptRoadmap: (agentId: string) => request<{ ok: boolean }>('/atria/roadmap-demand', { method: 'POST', body: { agentId } }),

  // ---- Atria: calendar materialize + campaign grant/status (Phases 04–05) ----
  materializeCalendar: (campaignId: string, slots: CalendarSlotDto[]) =>
    request<MaterializeResultDto>(`/campaigns/${campaignId}/materialize`, { method: 'POST', body: { slots } }),
  // Approve a strategist run's calendar: creates the campaign from the run, materializes, returns campaignId.
  materializeCalendarFromRun: (runId: string, slots: CalendarSlotDto[]) =>
    request<{ campaignId: string; materialize: MaterializeResultDto | null }>(
      `/orchestration/runs/${runId}/materialize-calendar`, { method: 'POST', body: { slots } },
    ),
  campaignStatus: (id: string) => request<CampaignStatusDto>(`/campaigns/${id}/status`),

  // ---- Workspaces (Atria v2 P0) — read-only reframe of Campaigns for the Command Center hub ----
  listWorkspaces: () => request<WorkspaceSummaryDto[]>('/workspaces'),
  getWorkspace: (campaignId: string) => request<WorkspaceDetailDto>(`/workspaces/${campaignId}`),

  // ---- Email Agent (Atria v2 P2-2c) — nurture leads via Gmail ----
  emailStatus: () => request<{ connected: boolean }>('/email/status'),
  nurtureLeads: () => request<NurtureLeadDto[]>('/email/leads'),
  draftEmail: (leadId: string) => request<EmailDraftDto>('/email/draft', { method: 'POST', body: { leadId } }),
  sendEmail: (leadId: string, subject: string, body: string) => request<{ leadId: string; sent: boolean; messageId: string | null }>('/email/send', { method: 'POST', body: { leadId, subject, body } }),

  // ---- Nurture Inbox (Lead Nurture Agent Phase 04) — thread timeline + approve/edit/reject ----
  listNurtureThreads: () => request<NurtureThreadListDto[]>('/nurture/threads'),
  getNurtureThread: (id: string) => request<NurtureThreadDetailDto>(`/nurture/threads/${id}`),
  approveNurtureTouch: (threadId: string, touchId: string, edited?: { editedSubject?: string; editedBody?: string }) =>
    request<NurtureThreadDetailDto>(`/nurture/threads/${threadId}/approve`, { method: 'POST', body: { touchId, ...(edited ?? {}) } }),
  rejectNurtureTouch: (threadId: string, touchId: string) =>
    request<NurtureThreadDetailDto>(`/nurture/threads/${threadId}/reject`, { method: 'POST', body: { touchId } }),
  pauseNurtureThread: (threadId: string) => request<NurtureThreadDetailDto>(`/nurture/threads/${threadId}/pause`, { method: 'POST' }),
  resumeNurtureThread: (threadId: string) => request<NurtureThreadDetailDto>(`/nurture/threads/${threadId}/resume`, { method: 'POST' }),
  convertNurtureThread: (threadId: string) => request<NurtureThreadDetailDto>(`/nurture/threads/${threadId}/convert`, { method: 'POST' }),
  optOutNurtureThread: (threadId: string) => request<NurtureThreadDetailDto>(`/nurture/threads/${threadId}/opt-out`, { method: 'POST' }),
  getNurtureSettings: () => request<NurtureSettingsDto>('/nurture/settings'),
  updateNurtureSettings: (patch: Partial<NurtureSettingsDto>) => request<NurtureSettingsDto>('/nurture/settings', { method: 'PUT', body: patch }),

  // ---- Memory Agent (Atria v2 P2-2a) — learn copy style from edits ----
  listMemories: () => request<MemoryDto[]>('/memory'),
  memoryProposals: () => request<MemoryProposalsDto>('/memory/proposals'),
  acceptMemory: (content: string, agentId?: string) => request<MemoryDto>('/memory/accept', { method: 'POST', body: { content, ...(agentId ? { agentId } : {}) } }),
  deleteMemory: (id: string) => request<void>(`/memory/${id}`, { method: 'DELETE' }),
  listMemoryFacts: () => request<MemoryFactDto[]>('/memory/facts'),
  deleteMemoryFact: (id: string) => request<void>(`/memory/facts/${id}`, { method: 'DELETE' }),
  grantCampaign: (id: string, body: { confirmationToken?: string; scheduleConfirmed?: boolean }) =>
    request<CampaignGrantResponse>(`/campaigns/${id}/grant-autonomy`, { method: 'POST', body }),
  grantPost: (postId: string, body: { confirmationToken?: string; scheduleConfirmed?: boolean } = {}) =>
    request<PostGrantResponse>(`/posts/${postId}/grant-autonomy`, { method: 'POST', body }),

  // ---- Atria: impact / value report (Phase 07) ----
  campaignImpact: (id: string) => request<ImpactReportDto>(`/campaigns/${id}/impact`),
  periodImpact: (period: '7d' | '30d' | '90d' | 'all' = '30d') =>
    request<ImpactReportDto>('/impact', { query: { period } }),
};

// Social OAuth connect is a full-page navigation (platform redirect), not a fetch.
export const connectUrl = (path: string): string => `${BASE}${path}`;

// Login is a full-page navigation (OAuth redirect), not a fetch.
export const loginUrl = (): string => `${BASE}/auth/google/start`;
