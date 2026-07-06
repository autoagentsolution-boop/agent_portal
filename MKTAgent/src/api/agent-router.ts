// Master Agent router. It keeps conversation history per user, returns natural
// assistant responses plus structured setup drafts, and stores credentials only as
// encrypted values. Never echo credential values back to the UI.
import { Router } from 'express';
import { ok, parseOr422, fail, asyncHandler } from './http.ts';
import {
  agentIntakeBody,
  appendAgentChatMessageBody,
  createAgentChatBody,
  saveAgentCredentialBody,
  type AgentIntakeDraft,
} from './schemas.ts';
import { GeminiAgentIntakeProvider } from '../agent/gemini-intake-provider.ts';
import { prisma } from '../db/client.ts';
import { encryptToken } from '../lib/crypto.ts';
import { verifyAndRecordFormToken } from '../tokens/service.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

// Which publisher access-token keys should trigger a liveness verification on save, so the
// Connections view reflects the TRUE status (not "connected" for an untested paste).
const ACCESS_TOKEN_KEY = /^(facebook|instagram|threads|linkedin|x)_access_token$/;
const REFRESH_TOKEN_KEY = /^(facebook|instagram|threads|linkedin|x)_refresh_token$/;

export const agentRouter: Router = Router();
const agentIntakeProvider = new GeminiAgentIntakeProvider();

// Keyed by CANONICAL registry agent id (snake_case) — the same id the DAG carries on
// WorkflowNode.agentId and the web credential config (web/src/flow/agent-credentials.ts).
// Keep the two in lockstep: a field here missing there (or vice-versa) breaks setup.
const credentialAllowlist: Record<string, string[]> = {
  concept_writer: ['gemini_api_key'],
  infographic: ['design_provider_key', 'design_client_id', 'design_client_secret'],
  storyboard: ['storyboard_provider_key'],
  video: ['video_provider_key', 'video_client_id', 'video_client_secret', 'tts_music_provider_key'],
  publisher: [
    'google_client_id',
    'google_client_secret',
    'google_refresh_token',
    'google_drive_refresh_token',
    'facebook_app_id',
    'facebook_app_secret',
    'facebook_page_id',
    'facebook_access_token',
    'instagram_app_id',
    'instagram_app_secret',
    'instagram_business_account_id',
    'instagram_access_token',
    'threads_app_id',
    'threads_app_secret',
    'threads_access_token',
    'linkedin_client_id',
    'linkedin_client_secret',
    'linkedin_access_token',
    'linkedin_author_urn',
    'x_client_id',
    'x_client_secret',
    'x_access_token',
    'x_refresh_token',
  ],
};

const titleFrom = (message: string): string => message.trim().replace(/\s+/g, ' ').slice(0, 80) || 'New setup chat';

const toChatDto = (session: any) => ({
  id: session.id,
  title: session.title,
  draft: session.draft ?? null,
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
  messages: (session.messages ?? []).map((m: any) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  })),
});

const parseDraft = async (message: string, timezone: string, ownerId?: string | null): Promise<AgentIntakeDraft> =>
  agentIntakeProvider.parse({ message, timezone }, ownerId);

const appendAssistant = async (sessionId: string, draft: AgentIntakeDraft): Promise<void> => {
  const content = draft.assistantMessage ?? draft.nextQuestion ?? 'I updated the setup draft.';
  await prisma.agentChatMessage.create({ data: { sessionId, role: 'agent', content } });
  await prisma.agentChatSession.update({ where: { id: sessionId }, data: { draft: draft as object } });
};

agentRouter.post('/intake', asyncHandler(async (req, res) => {
  const body = parseOr422(res, agentIntakeBody, req.body ?? {});
  if (!body) return;
  ok(res, await parseDraft(body.message, body.timezone, req.userId!));
}));

agentRouter.get('/chats', asyncHandler(async (req, res) => {
  const ownerId = req.userId!;
  const sessions = await prisma.agentChatSession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  ok(res, sessions.map(toChatDto));
}));

agentRouter.post('/chats', asyncHandler(async (req, res) => {
  const ownerId = req.userId!;
  const body = parseOr422(res, createAgentChatBody, req.body ?? {});
  if (!body) return;
  const session = await prisma.agentChatSession.create({ data: { ownerId, title: body.title } });
  if (body.message) {
    await prisma.agentChatMessage.create({ data: { sessionId: session.id, role: 'user', content: body.message } });
    await appendAssistant(session.id, await parseDraft(body.message, body.timezone, ownerId));
  }
  const full = await prisma.agentChatSession.findFirst({
    where: { id: session.id, ownerId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  ok(res, toChatDto(full));
}));

agentRouter.get('/chats/:id', asyncHandler(async (req, res) => {
  const session = await prisma.agentChatSession.findFirst({
    where: { id: req.params.id, ownerId: req.userId! },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!session) { fail(res, 404, 'chat_not_found'); return; }
  ok(res, toChatDto(session));
}));

agentRouter.post('/chats/:id/messages', asyncHandler(async (req, res) => {
  const body = parseOr422(res, appendAgentChatMessageBody, req.body ?? {});
  if (!body) return;
  const session = await prisma.agentChatSession.findFirst({ where: { id: req.params.id, ownerId: req.userId! } });
  if (!session) { fail(res, 404, 'chat_not_found'); return; }
  await prisma.agentChatMessage.create({ data: { sessionId: session.id, role: 'user', content: body.message } });
  await appendAssistant(session.id, await parseDraft(body.message, body.timezone, req.userId!));
  const full = await prisma.agentChatSession.findFirst({
    where: { id: session.id, ownerId: req.userId! },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  ok(res, toChatDto(full));
}));

agentRouter.delete('/chats/:id', asyncHandler(async (req, res) => {
  const deleted = await prisma.agentChatSession.deleteMany({ where: { id: req.params.id, ownerId: req.userId! } });
  if (deleted.count === 0) { fail(res, 404, 'chat_not_found'); return; }
  res.status(204).end();
}));

agentRouter.get('/credentials/status', asyncHandler(async (req, res) => {
  const creds = await prisma.agentCredential.findMany({ where: { ownerId: req.userId! } });
  ok(res, creds.map((c) => ({ agentId: c.agentId, key: c.key, status: c.status, updatedAt: c.updatedAt.toISOString() })));
}));

agentRouter.put('/credentials/:agentId/:key', asyncHandler(async (req, res) => {
  const { agentId, key } = req.params;
  if (!credentialAllowlist[agentId]?.includes(key)) { fail(res, 422, 'credential_key_not_allowed'); return; }
  const body = parseOr422(res, saveAgentCredentialBody, req.body ?? {});
  if (!body) return;
  const credential = await prisma.agentCredential.upsert({
    where: { ownerId_agentId_key: { ownerId: req.userId!, agentId, key } },
    update: { value: encryptToken(body.value), status: 'active' },
    create: { ownerId: req.userId!, agentId, key, value: encryptToken(body.value), status: 'active' },
  });

  // A pasted platform access token: verify liveness NOW and record the real connection
  // status so the Connections card doesn't claim "connected" for an untested/expired token.
  // A pasted refresh token re-runs the same sync so it lands on the OAuthToken row immediately
  // (no need to re-save the access token) — enabling auto-refresh for a form-connected platform.
  let verify: { alive: boolean; reason?: string; identity?: string } | undefined;
  const syncKey = ACCESS_TOKEN_KEY.test(key) || REFRESH_TOKEN_KEY.test(key);
  if (agentId === 'publisher' && syncKey) {
    const platform = key.replace(/_(access|refresh)_token$/, '') as SocialPlatform;
    verify = await verifyAndRecordFormToken(req.userId!, platform);
  }

  ok(res, { agentId, key, status: credential.status, updatedAt: credential.updatedAt.toISOString(), verify });
}));

agentRouter.delete('/credentials/:agentId/:key', asyncHandler(async (req, res) => {
  const { agentId, key } = req.params;
  await prisma.agentCredential.deleteMany({ where: { ownerId: req.userId!, agentId, key } });
  ok(res, { deleted: true });
}));
