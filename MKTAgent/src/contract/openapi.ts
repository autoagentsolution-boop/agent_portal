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

// ---- SSE -----------------------------------------------------------------------
registry.registerPath({
  method: 'get',
  path: '/events',
  tags: ['events'],
  summary: 'Server-Sent Events stream of this user\'s post status changes',
  description:
    'text/event-stream. Auth via Bearer header OR ?token= query (EventSource). ' +
    'Emits `ready` then `post.status` events: {postId,status,campaignId,postUrls,error,at}.',
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
