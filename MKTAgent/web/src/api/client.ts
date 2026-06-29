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
export type PostDto = Dto['PostDto'];
export type PostDetailDto = Dto['PostDetailDto'];
export type LeadDto = Dto['LeadDto'];
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
export type AgentCredentialStatusDto = { agentId: string; key: string; status: string; updatedAt: string };

// Orchestration (M1 backbone) — the goal-based agent workflow surface.
export type WorkflowRunDto = Dto['WorkflowRunDto'];

// Connections (M2-lite) — read-only social connection status.
export type ConnectionDto = Dto['ConnectionDto'];

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
  listAgentCredentialStatus: () => request<AgentCredentialStatusDto[]>('/agent/credentials/status'),
  saveAgentCredential: (agentId: string, key: string, value: string) =>
    request<AgentCredentialStatusDto>(`/agent/credentials/${agentId}/${key}`, { method: 'PUT', body: { value } }),
  deleteAgentCredential: (agentId: string, key: string) =>
    request<{ deleted: boolean }>(`/agent/credentials/${agentId}/${key}`, { method: 'DELETE' }),

  listCampaigns: () => request<CampaignDto[]>('/campaigns'),
  createCampaign: (body: Dto['CreateCampaignBody']) =>
    request<CampaignDto>('/campaigns', { method: 'POST', body }),
  updateCampaign: (id: string, body: Dto['UpdateCampaignBody']) =>
    request<CampaignDto>(`/campaigns/${id}`, { method: 'PATCH', body }),
  deleteCampaign: (id: string) => request<void>(`/campaigns/${id}`, { method: 'DELETE' }),

  listPosts: (query?: { status?: string; campaignId?: string; limit?: number; cursor?: string }) =>
    request<PostDto[]>('/posts', { query }),
  getPost: (id: string) => request<PostDetailDto>(`/posts/${id}`),
  createPost: (body: Dto['CreatePostBody']) => request<PostDto>('/posts', { method: 'POST', body }),
  updatePost: (id: string, body: Dto['UpdatePostBody']) =>
    request<PostDto>(`/posts/${id}`, { method: 'PATCH', body }),
  deletePost: (id: string) => request<void>(`/posts/${id}`, { method: 'DELETE' }),

  generate: (id: string) => request<PostDto>(`/posts/${id}/generate`, { method: 'POST' }),
  approve: (id: string, scheduledAt?: string) =>
    request<PostDto>(`/posts/${id}/approve`, { method: 'POST', body: scheduledAt ? { scheduledAt } : {} }),
  reject: (id: string, feedback: string) =>
    request<PostDto>(`/posts/${id}/reject`, { method: 'POST', body: { feedback } }),
  publishNow: (id: string) => request<PostDto>(`/posts/${id}/publish-now`, { method: 'POST' }),

  listLeads: () => request<LeadDto[]>('/leads'),

  // ---- Orchestration (M1 goal-based agent workflows) ----
  createRun: (message: string, chatSessionId?: string) =>
    request<WorkflowRunDto>('/orchestration/runs', { method: 'POST', body: { message, ...(chatSessionId ? { chatSessionId } : {}) } }),
  clarifyRun: (id: string, answers: Record<string, string | string[]>) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/clarify`, { method: 'POST', body: { answers } }),
  approveRun: (id: string) => request<WorkflowRunDto>(`/orchestration/runs/${id}/approve`, { method: 'POST' }),
  approveRunNode: (id: string, nodeId: string) =>
    request<WorkflowRunDto>(`/orchestration/runs/${id}/approve-node/${nodeId}`, { method: 'POST' }),
  getRun: (id: string) => request<WorkflowRunDto>(`/orchestration/runs/${id}`),
  // History restore: latest run behind a chat session (404 → chat has no run).
  getRunByChat: (chatSessionId: string) => request<WorkflowRunDto>(`/orchestration/runs/by-chat/${chatSessionId}`),
  listRuns: () => request<Array<{ id: string; status: string; createdAt: string; updatedAt: string }>>('/orchestration/runs'),

  // ---- Connections (M2-lite, read-only) ----
  listConnections: () => request<ConnectionDto[]>('/connections'),
};

// Social OAuth connect is a full-page navigation (platform redirect), not a fetch.
export const connectUrl = (path: string): string => `${BASE}${path}`;

// Login is a full-page navigation (OAuth redirect), not a fetch.
export const loginUrl = (): string => `${BASE}/auth/google/start`;
