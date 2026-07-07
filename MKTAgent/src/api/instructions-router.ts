// Instructions router (Atria Phase 02). Owner-scoped CRUD over the user's layered "Atria
// Instructions" (workspace → campaign → post, optionally agent-targeted). Boring + small; the
// Phase-08 instruction editor drives it. All rows are tenant-isolated via requireAuth.
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import {
  createInstruction,
  listInstructions,
  updateInstruction,
  deleteInstruction,
} from '../db/repos/instruction-repo.ts';
import type { Instruction, InstructionScope } from '../../prisma/generated/prisma/client.ts';

export const instructionsRouter: Router = Router();

const toDto = (i: Instruction) => ({
  id: i.id,
  scope: i.scope,
  scopeRefId: i.scopeRefId,
  agentId: i.agentId,
  content: i.content,
  enabled: i.enabled,
  source: i.source,
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
});

const SCOPES = ['workspace', 'campaign', 'post'] as const;

// List, optionally filtered by scope (+ ref). ?scope=workspace | ?scope=campaign&refId=<uuid>
const listQuery = z.object({
  scope: z.enum(SCOPES).optional(),
  refId: z.string().uuid().optional(),
}).strict();

instructionsRouter.get('/', asyncHandler(async (req, res) => {
  const q = parseOr422(res, listQuery, req.query ?? {});
  if (!q) return;
  const rows = await listInstructions(req.userId!, {
    scope: q.scope as InstructionScope | undefined,
    ...(q.refId !== undefined ? { scopeRefId: q.refId } : {}),
  });
  ok(res, rows.map(toDto), { count: rows.length, nextCursor: null });
}));

// Create. workspace → no scopeRefId; campaign/post → scopeRefId (uuid) required.
const createBody = z.object({
  scope: z.enum(SCOPES),
  scopeRefId: z.string().uuid().nullish(),
  agentId: z.string().min(1).max(60).nullish(),
  content: z.string().min(1).max(4000),
  enabled: z.boolean().optional(),
}).strict().superRefine((b, ctx) => {
  if (b.scope === 'workspace' && b.scopeRefId) {
    ctx.addIssue({ code: 'custom', path: ['scopeRefId'], message: 'workspace scope must not set scopeRefId' });
  }
  if (b.scope !== 'workspace' && !b.scopeRefId) {
    ctx.addIssue({ code: 'custom', path: ['scopeRefId'], message: `${b.scope} scope requires scopeRefId` });
  }
});

instructionsRouter.post('/', asyncHandler(async (req, res) => {
  const body = parseOr422(res, createBody, req.body ?? {});
  if (!body) return;
  const row = await createInstruction({
    ownerId: req.userId!,
    scope: body.scope as InstructionScope,
    scopeRefId: body.scopeRefId ?? null,
    agentId: body.agentId ?? null,
    content: body.content,
    enabled: body.enabled,
    // v1 always user-authored; the Memory Agent (v2) is the only writer of source:'memory'.
    source: 'user',
  });
  res.status(201);
  ok(res, toDto(row));
}));

const patchBody = z.object({
  content: z.string().min(1).max(4000).optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().min(1).max(60).nullish(),
}).strict();

instructionsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const body = parseOr422(res, patchBody, req.body ?? {});
  if (!body) return;
  const row = await updateInstruction(req.params.id, req.userId!, body);
  if (!row) return fail(res, 404, 'instruction_not_found');
  ok(res, toDto(row));
}));

instructionsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const okDel = await deleteInstruction(req.params.id, req.userId!);
  if (!okDel) return fail(res, 404, 'instruction_not_found');
  res.status(204).end();
}));
