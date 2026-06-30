// OpenAPI 3.1 spec generator (T5). The Zod schemas in api/schemas.ts are the
// single source of truth; this module registers them + the route definitions with
// @asteasolutions/zod-to-openapi and emits openapi.json. The UI then runs
// openapi-typescript against that file for a typed client — no hand-synced types.
//
// Run: npx tsx src/contract/openapi.ts  → writes openapi.json at the repo root.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  postStatus,
  assetType,
  socialPlatform,
  listPostsQuery,
  approvePostBody,
  rejectPostBody,
  campaignDto,
  postDto,
  postDetailDto,
  copyBag,
  leadDto,
  leadSource,
  leadCaptureResult,
  createCampaignBody,
  updateCampaignBody,
  createPostBody,
  updatePostBody,
  createRunBody,
  clarifyRunBody,
  saveRunBody,
  savedRunDto,
  workflowRunDto,
} from '../api/schemas.ts';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// ---- Security scheme: Bearer JWT (Google-login → long-lived token, T1). --------
const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// Browser session cookie (T8 BFF) — opaque HttpOnly handle set by the Google login
// callback. The UI authenticates with this; the JWT never reaches the client.
const sessionCookie = registry.registerComponent('securitySchemes', 'sessionCookie', {
  type: 'apiKey',
  in: 'cookie',
  name: 'mkt_session',
});

// Webhook intake secret (lead funnels — no JWT). Header for webhook/form.
const webhookSecret = registry.registerComponent('securitySchemes', 'webhookSecret', {
  type: 'apiKey',
  in: 'header',
  name: 'x-webhook-secret',
});

// User-facing endpoints accept EITHER the Bearer JWT (CLI/tests) or the session
// cookie (browser). Reused on every tenant-scoped path's `security`.
const userAuth = [{ [bearer.name]: [] }, { [sessionCookie.name]: [] }];

// ---- Component schemas (registered under stable names → $ref in the spec). ------
registry.register('PostStatus', postStatus);
registry.register('AssetType', assetType);
registry.register('SocialPlatform', socialPlatform);
registry.register('CopyBag', copyBag);
const CampaignDto = registry.register('CampaignDto', campaignDto);
const PostDto = registry.register('PostDto', postDto);
const PostDetailDto = registry.register('PostDetailDto', postDetailDto);
registry.register('ApprovePostBody', approvePostBody);
registry.register('RejectPostBody', rejectPostBody);
const CreateCampaignBody = registry.register('CreateCampaignBody', createCampaignBody);
const UpdateCampaignBody = registry.register('UpdateCampaignBody', updateCampaignBody);
const CreatePostBody = registry.register('CreatePostBody', createPostBody);
const UpdatePostBody = registry.register('UpdatePostBody', updatePostBody);
registry.register('LeadSource', leadSource);
const LeadDto = registry.register('LeadDto', leadDto);
const LeadCaptureResult = registry.register('LeadCaptureResult', leadCaptureResult);
const CreateRunBody = registry.register('CreateRunBody', createRunBody);
const ClarifyRunBody = registry.register('ClarifyRunBody', clarifyRunBody);
const SaveRunBody = registry.register('SaveRunBody', saveRunBody);
const SavedRunDto = registry.register('SavedRunDto', savedRunDto);
const WorkflowRunDto = registry.register('WorkflowRunDto', workflowRunDto);

// ---- Envelopes: every response is { data, meta? } | { error, details? }. -------
const listMeta = z.object({ count: z.number().int(), nextCursor: z.string().uuid().nullable() });
const errorEnvelope = registry.register(
  'ErrorEnvelope',
  z.object({ error: z.string(), details: z.unknown().optional() }),
);
const dataEnvelope = <T extends z.ZodTypeAny>(data: T): z.ZodTypeAny =>
  z.object({ data });
const listEnvelope = <T extends z.ZodTypeAny>(item: T): z.ZodTypeAny =>
  z.object({ data: z.array(item), meta: listMeta });

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const errorResponse = (description: string) => ({ description, content: json(errorEnvelope) });

// ---- Auth ----------------------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['auth'],
  summary: 'Current authenticated user',
  security: [{ [bearer.name]: [] }],
  responses: {
    200: {
      description: 'The logged-in user identity + config defaults',
      content: json(
        dataEnvelope(
          z.object({
            id: z.string().uuid(),
            email: z.string().email(),
            displayName: z.string().nullable(),
            avatarUrl: z.string().nullable(),
            accountType: z.enum(['business', 'personal']),
            defaultLanguage: z.string(),
            role: z.string(),
          }),
        ),
      ),
    },
    401: errorResponse('Missing/invalid token'),
    404: errorResponse('User not found'),
  },
});

// ---- Posts ---------------------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/posts',
  tags: ['posts'],
  summary: 'List the current user\'s posts (keyset-paginated)',
  security: [{ [bearer.name]: [] }],
  request: { query: listPostsQuery },
  responses: {
    200: { description: 'Page of posts', content: json(listEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    422: errorResponse('Invalid query params'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/posts/{id}',
  tags: ['posts'],
  summary: 'Get one post with its embedded campaign',
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Post detail', content: json(dataEnvelope(PostDetailDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/posts/{id}/approve',
  tags: ['posts'],
  summary: 'Approve a post in review → ready (schedules it)',
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: json(approvePostBody) },
  },
  responses: {
    200: { description: 'Updated post', content: json(dataEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Post is not in review state'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/posts/{id}/reject',
  tags: ['posts'],
  summary: 'Reject a post in review → rework (with feedback)',
  security: [{ [bearer.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: json(rejectPostBody) },
  },
  responses: {
    200: { description: 'Updated post', content: json(dataEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Post is not in review state'),
    422: errorResponse('Invalid body'),
  },
});

// ---- Auth: logout (T8) ---------------------------------------------------------
registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'Revoke the current browser session (clears the cookie)',
  security: [{ [sessionCookie.name]: [] }],
  responses: {
    200: { description: 'Logged out', content: json(dataEnvelope(z.object({ loggedOut: z.boolean() }))) },
  },
});

// ---- Posts CRUD (T7) -----------------------------------------------------------
const uuidParam = z.object({ id: z.string().uuid() });

// ---- Manual triggers (T8) — UI Generate / Publish-now buttons ------------------
registry.registerPath({
  method: 'post',
  path: '/posts/{id}/generate',
  tags: ['posts'],
  summary: 'Run copy-gen for this post now (brief|rework → review)',
  description: 'On-demand copy generation instead of waiting for the cron. Shares the copy-gen advisory lock.',
  security: userAuth,
  request: { params: uuidParam },
  responses: {
    200: { description: 'Generated post (status=review)', content: json(dataEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Copy-gen busy, or post not in brief/rework'),
    502: errorResponse('Generation failed (transient/upstream)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/posts/{id}/publish-now',
  tags: ['posts'],
  summary: 'Publish this post now (ready → posting → fan-out). REAL social post.',
  description: 'User-triggered immediate publish after review; coexists with the scheduler cron (first to claim wins).',
  security: userAuth,
  request: { params: uuidParam },
  responses: {
    200: { description: 'Publish outcome (status posted|partial|error)', content: json(dataEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Post not in ready state'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/posts',
  tags: ['posts'],
  summary: 'Create a post (brief) under one of the user\'s campaigns',
  security: [{ [bearer.name]: [] }],
  request: { body: { content: json(CreatePostBody) } },
  responses: {
    201: { description: 'Created post (status=brief)', content: json(dataEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Campaign not found / cross-tenant'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/posts/{id}',
  tags: ['posts'],
  summary: 'Edit a post\'s config (asset/targets/schedule). Editable states only.',
  security: [{ [bearer.name]: [] }],
  request: { params: uuidParam, body: { content: json(UpdatePostBody) } },
  responses: {
    200: { description: 'Updated post', content: json(dataEnvelope(PostDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Post is in a non-editable (scheduler-owned) state'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/posts/{id}',
  tags: ['posts'],
  summary: 'Delete a post (blocked while publishing)',
  security: [{ [bearer.name]: [] }],
  request: { params: uuidParam },
  responses: {
    204: { description: 'Deleted' },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Post is being published; cannot delete'),
  },
});

// ---- Campaigns CRUD (T7) -------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/campaigns',
  tags: ['campaigns'],
  summary: 'List the current user\'s campaigns',
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'Campaigns', content: json(dataEnvelope(z.array(CampaignDto))) },
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/campaigns',
  tags: ['campaigns'],
  summary: 'Create a campaign',
  security: [{ [bearer.name]: [] }],
  request: { body: { content: json(CreateCampaignBody) } },
  responses: {
    201: { description: 'Created campaign', content: json(dataEnvelope(CampaignDto)) },
    401: errorResponse('Unauthorized'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/campaigns/{id}',
  tags: ['campaigns'],
  summary: 'Get one campaign',
  security: [{ [bearer.name]: [] }],
  request: { params: uuidParam },
  responses: {
    200: { description: 'Campaign', content: json(dataEnvelope(CampaignDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/campaigns/{id}',
  tags: ['campaigns'],
  summary: 'Update a campaign (partial)',
  security: [{ [bearer.name]: [] }],
  request: { params: uuidParam, body: { content: json(UpdateCampaignBody) } },
  responses: {
    200: { description: 'Updated campaign', content: json(dataEnvelope(CampaignDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/campaigns/{id}',
  tags: ['campaigns'],
  summary: 'Delete a campaign (cascades to its posts)',
  security: [{ [bearer.name]: [] }],
  request: { params: uuidParam },
  responses: {
    204: { description: 'Deleted' },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
  },
});

// ---- Connect (per-user social OAuth, T4) ---------------------------------------
registry.registerPath({
  method: 'get',
  path: '/connect/{platform}/start',
  tags: ['connect'],
  summary: 'Begin per-user OAuth for a social platform (302 to consent)',
  security: [{ [bearer.name]: [] }],
  request: { params: z.object({ platform: socialPlatform }) },
  responses: {
    302: { description: 'Redirect to the platform consent screen' },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Unknown platform'),
    500: errorResponse('Platform OAuth client not configured'),
  },
});

// ---- Connections (M2-lite, read-only social connection status) -----------------
const ConnectionDto = registry.register(
  'ConnectionDto',
  z.object({
    platformKey: socialPlatform,
    displayName: z.string(),
    state: z.enum(['connected', 'needs_attention', 'not_connected']),
    expiresAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    capabilities: z.array(z.string()),
    connectUrl: z.string(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/connections',
  tags: ['connections'],
  summary: 'List the caller\'s social connections + status (read-only)',
  description: 'Metadata-only view over the OAuthToken store. Never returns token values and never touches the publish path. Unconnected platforms appear as not_connected with a connectUrl.',
  security: userAuth,
  responses: {
    200: { description: 'Connection status per platform', content: json(listEnvelope(ConnectionDto)) },
    401: errorResponse('Unauthorized'),
  },
});

// ---- Leads (T6) ----------------------------------------------------------------
const leadIntakeBody = z.object({}).passthrough().openapi({
  description: 'Open-shaped funnel payload (fields vary by source); email is required after normalization.',
});

const leadIntakePath = (path: string, summary: string, query?: z.AnyZodObject) =>
  registry.registerPath({
    method: 'post',
    path,
    tags: ['leads'],
    summary,
    security: [{ [webhookSecret.name]: [] }],
    request: {
      ...(query ? { query } : {}),
      body: { content: json(leadIntakeBody) },
    },
    responses: {
      200: { description: 'Capture outcome (created/duplicate/ignored)', content: json(dataEnvelope(LeadCaptureResult)) },
      400: errorResponse('Invalid payload (e.g. bad email)'),
      401: errorResponse('Bad/missing webhook secret'),
      503: errorResponse('Webhook secret not configured'),
    },
  });

leadIntakePath('/leads/webhook', 'Generic JSON lead intake (header x-webhook-secret)');
leadIntakePath('/leads/form', 'Google-Form-style row intake (header x-webhook-secret)');
leadIntakePath(
  '/leads/calcom',
  'Cal.com BOOKING_CREATED intake (query ?s=secret)',
  z.object({ s: z.string() }),
);

registry.registerPath({
  method: 'get',
  path: '/leads',
  tags: ['leads'],
  summary: 'List the current user\'s captured leads',
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'Leads (most recent first)', content: json(listEnvelope(LeadDto)) },
    401: errorResponse('Unauthorized'),
  },
});

// ---- Orchestration (goal-based agent workflows, Milestone 1) --------------------
const runIdParam = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'post',
  path: '/orchestration/runs',
  tags: ['orchestration'],
  summary: 'Start a goal-based run: analyze a message → clarify or plan a DAG',
  description: 'Master Agent extracts intent, asks clarification if required slots are missing, else plans a dynamic agent DAG. Returns the run (status awaiting_clarification | planned | failed).',
  security: userAuth,
  request: { body: { content: json(CreateRunBody) } },
  responses: {
    201: { description: 'Created run', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/orchestration/runs/{id}/clarify',
  tags: ['orchestration'],
  summary: 'Answer clarification questions → re-plan the run',
  security: userAuth,
  request: { params: runIdParam, body: { content: json(ClarifyRunBody) } },
  responses: {
    200: { description: 'Re-planned run', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Run is not awaiting clarification'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/orchestration/runs/{id}/save',
  tags: ['orchestration'],
  summary: 'Save a planned run as a named Saved Flow (no execution)',
  description: 'Names a planned run so it appears in Saved Flows. Does NOT execute — execution happens later via /execute from Active Flows.',
  security: userAuth,
  request: { params: runIdParam, body: { content: json(SaveRunBody) } },
  responses: {
    200: { description: 'Named run (still planned)', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Run is not in planned state'),
    422: errorResponse('Invalid body'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/orchestration/runs/{id}/execute',
  tags: ['orchestration'],
  summary: 'Execute a planned/failed run (async) → returns immediately as running',
  description: 'Flips the run to running and executes the DAG DETACHED (the request returns at once — no long hang). SSE (/events) drives live node status; the executor halts BEFORE the external-write node (publisher) → needs_approval. Re-runnable from a failed state.',
  security: userAuth,
  request: { params: runIdParam },
  responses: {
    200: { description: 'Run now running (live status via SSE)', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Run already in flight or not executable'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/orchestration/runs/{id}/approve-node/{nodeId}',
  tags: ['orchestration'],
  summary: 'Approve a gated node (e.g. publisher) → resume execution (async)',
  description: 'Releases the approval gate for one external-write node and resumes the run DETACHED (returns at once; SSE drives status). Publishing runs the real publish path.',
  security: userAuth,
  request: { params: z.object({ id: z.string().uuid(), nodeId: z.string() }) },
  responses: {
    200: { description: 'Run now running (live status via SSE)', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Run is not awaiting approval'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/orchestration/runs/saved',
  tags: ['orchestration'],
  summary: 'List named Saved Flows (for the sidebar + Active Flows)',
  security: userAuth,
  responses: {
    200: { description: 'Saved flows (most recent first)', content: json(listEnvelope(SavedRunDto)) },
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/orchestration/runs',
  tags: ['orchestration'],
  summary: 'List the current user\'s workflow runs',
  security: userAuth,
  responses: {
    200: { description: 'Runs (most recent first)', content: json(listEnvelope(z.object({ id: z.string().uuid(), status: z.string(), createdAt: z.string(), updatedAt: z.string() }))) },
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/orchestration/runs/by-chat/{chatSessionId}',
  tags: ['orchestration'],
  summary: 'Get the latest run for a chat session (history restore)',
  description: 'Conversational unify: reopen the run a chat spawned. 404 when the chat has no run (legacy intake-only chat).',
  security: userAuth,
  request: { params: z.object({ chatSessionId: z.string().uuid() }) },
  responses: {
    200: { description: 'Latest run for the chat', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('No run for this chat / cross-tenant'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/orchestration/runs/{id}',
  tags: ['orchestration'],
  summary: 'Get a run with its nodes + artifacts',
  security: userAuth,
  request: { params: runIdParam },
  responses: {
    200: { description: 'Run detail', content: json(dataEnvelope(WorkflowRunDto)) },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/orchestration/runs/{id}',
  tags: ['orchestration'],
  summary: 'Delete a run / Saved Flow (cascades to nodes + artifacts)',
  description: 'Removes the run and all its nodes + artifacts. A run mid-execution (running) is refused with 409.',
  security: userAuth,
  request: { params: runIdParam },
  responses: {
    204: { description: 'Deleted' },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found / cross-tenant'),
    409: errorResponse('Run is executing; cannot delete'),
  },
});

// ---- SSE -----------------------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/events',
  tags: ['events'],
  summary: 'Server-Sent Events stream of this user\'s status changes',
  description:
    'text/event-stream. Auth via Bearer header OR ?token= query (EventSource). ' +
    'Emits `ready` then `post.status` {postId,status,campaignId,postUrls,error,at} ' +
    'and `node.status` {runId,nodeId,agentId,status,error,at} events.',
  security: [{ [bearer.name]: [] }],
  responses: {
    200: { description: 'SSE stream (Content-Type: text/event-stream)' },
    401: errorResponse('Unauthorized'),
  },
});

export const buildOpenApiDocument = (): object => {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MKTAgent API',
      version: '0.1.0',
      description:
        'Multi-tenant marketing automation API. All endpoints are tenant-scoped via ' +
        'the Bearer JWT (Google login). Responses use the { data, meta? } | { error, details? } envelope.',
    },
    servers: [{ url: 'http://localhost:7100', description: 'local dev' }],
  });
};

// CLI entry: emit openapi.json at the repo root (MKTAgent/).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const doc = buildOpenApiDocument();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, '../../openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2));
  // eslint-disable-next-line no-console
  console.log(`openapi.json written → ${out} (${Object.keys((doc as { paths: object }).paths).length} paths)`);
}
