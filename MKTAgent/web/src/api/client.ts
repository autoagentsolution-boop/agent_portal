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
export type PostDto = Dto['PostDto'] & {
  versionCount?: number | null;
  leadCollectorStatus?: string | null;
  commentSourceIds?: Record<string, string> | null;
  leadCollectorExpiresAt?: string | null;
};
// Per-platform on-demand liveness check (§01.4 "Check links") — route not in openapi yet.
export type LinkStatusEntry = { platform: string; url: string; alive: boolean | null };
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
  credits: number;
  calls: number;
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
  details?: unknown;
}

export type Result<T> = { ok: true; data: T; meta?: unknown } | { ok: false; error: ApiError };

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

async function request<T>(path: string, opts: RequestOpts = {}): Promise<Result<T>> {
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
  if (res.ok) return { ok: true, data: (json as { data: T }).data, meta: (json as { meta?: unknown }).meta };
  return { ok: false, error: { status: res.status, error: (json as { error?: string }).error ?? 'error', details: (json as { details?: unknown }).details } };
}

// ---- Endpoint helpers (thin, typed) --------------------------------------------
export type Me = NonNullable<
  paths['/auth/me']['get']['responses']['200']['content']['application/json']['data']
>;

export const api = {
  me: () => request<Me>('/auth/me'),
  logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),

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
  listProductKnowledge: () => request<ProductKnowledgeEntry[]>('/product-knowledge'),
  updateProductKnowledge: (id: string, body: { name?: string; productDetails?: string; brandVoice?: string | null; language?: string | null }) =>
    request<ProductKnowledgeEntry>(`/product-knowledge/${id}`, { method: 'PATCH', body }),
  deleteProductKnowledge: (id: string) => request<void>(`/product-knowledge/${id}`, { method: 'DELETE' }),
  listCampaigns: () => request<CampaignDto[]>('/campaigns'),
  getCampaign: (id: string) => request<CampaignDto>(`/campaigns/${id}`),
  // Lead Collector (§01)
  listLeads: () => request<LeadRow[]>('/leads'),
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
    request<PostDto[]>('/posts', { query }),
  getPost: (id: string) => request<PostDetailDto>(`/posts/${id}`),
  getPostability: (id: string) => request<PostabilityDto>(`/posts/${id}/postability`),
  createPost: (body: Dto['CreatePostBody']) => request<PostDto>('/posts', { method: 'POST', body }),
  // Agent-authored create (item 3): the Master Agent extracts the brief from a free-text
  // description so the user never hand-fills the form. First call may return `questions`
  // (the agent needs more info); passing `answers` on the second call creates the post
  // (`post` + `filled` — the fields it captured).
  createPostFromAgent: (campaignId: string, message: string, answers?: Record<string, string | string[]>) =>
    request<Dto['PostFromAgentDto']>('/posts/from-agent', { method: 'POST', body: { campaignId, message, ...(answers ? { answers } : {}) } }),
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
  createRun: (message: string, chatSessionId?: string) =>
    request<WorkflowRunDto>('/orchestration/runs', { method: 'POST', body: { message, ...(chatSessionId ? { chatSessionId } : {}) } }),
  clarifyRun: (id: string, answers: Record<string, string | string[]>) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/clarify`, { method: 'POST', body: { answers } }),
  // Save a planned run as a named Saved Flow (chat "Approve" → name + redirect).
  saveRun: (id: string, name: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/save`, { method: 'POST', body: { name } }),
  // Rename an existing saved flow (any status) — inline rename in SavedFlowDetail.
  renameRun: (id: string, name: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}`, { method: 'PATCH', body: { name } }),
  // Execute a saved/planned flow (async — returns running immediately; SSE drives the DAG).
  executeRun: (id: string) => request<WorkflowRunDto>(`/orchestration/runs/${id}/execute`, { method: 'POST' }),
  approveRunNode: (id: string, nodeId: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/approve-node/${nodeId}`, { method: 'POST' }),
  rerunRunNode: (id: string, nodeId: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/rerun-node/${nodeId}`, { method: 'POST' }),
  getRun: (id: string) => request<WorkflowRunDto>(`/orchestration/runs/${id}`),
  // History restore: latest run behind a chat session (404 → chat has no run).
  getRunByChat: (chatSessionId: string) => request<WorkflowRunDto>(`/orchestration/runs/by-chat/${chatSessionId}`),
  listRuns: () => request<Array<{ id: string; status: string; createdAt: string; updatedAt: string }>>('/orchestration/runs'),
  // Saved Flows (named runs) for the sidebar + Active Flows surface.
  listSavedRuns: () => request<SavedRunDto[]>('/orchestration/runs/saved'),
  deleteRun: (id: string) => request<void>(`/orchestration/runs/${id}`, { method: 'DELETE' }),

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
};

// Social OAuth connect is a full-page navigation (platform redirect), not a fetch.
export const connectUrl = (path: string): string => `${BASE}${path}`;

// Login is a full-page navigation (OAuth redirect), not a fetch.
export const loginUrl = (): string => `${BASE}/auth/google/start`;
