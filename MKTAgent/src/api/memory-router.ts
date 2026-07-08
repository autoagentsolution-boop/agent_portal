// Memory router (Atria v2 P2-2a). The Memory Agent's surface: analyse the user's hand-edited copy
// into proposed learned-style rules, and — on explicit approval — persist them as source:'memory'
// instructions that future concept_writer runs honour. List/delete manage the learned set. All
// tenant-scoped via requireAuth. Storage reuses the instruction repo (memory rows are just
// instructions with source='memory'); resolution reuses resolveInstructions (no new inject path).
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { createInstruction, listInstructions, deleteInstruction } from '../db/repos/instruction-repo.ts';
import { proposeMemories, MEMORY_TARGET_AGENT } from '../orchestration/atria/memory-agent.ts';
import type { Instruction } from '../../prisma/generated/prisma/client.ts';

export const memoryRouter: Router = Router();

const toDto = (i: Instruction) => ({
  id: i.id,
  agentId: i.agentId,
  content: i.content,
  enabled: i.enabled,
  createdAt: i.createdAt.toISOString(),
});

// Learned memories = the owner's source:'memory' instructions (newest first).
memoryRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await listInstructions(req.userId!);
  const memories = rows.filter((i) => i.source === 'memory').map(toDto);
  ok(res, memories, { count: memories.length });
}));

// Analyse edited copy → proposals (nothing persisted). Surfaces the edit signal too, so the UI can
// explain why there are (or aren't) proposals.
memoryRouter.get('/proposals', asyncHandler(async (req, res) => {
  ok(res, await proposeMemories(req.userId!));
}));

// Approve one proposal → a workspace-scoped, concept_writer-targeted learned instruction.
const acceptBody = z.object({
  content: z.string().min(1).max(4000),
  agentId: z.string().min(1).max(60).optional(),
}).strict();

memoryRouter.post('/accept', asyncHandler(async (req, res) => {
  const body = parseOr422(res, acceptBody, req.body ?? {});
  if (!body) return;
  const row = await createInstruction({
    ownerId: req.userId!,
    scope: 'workspace',
    agentId: body.agentId ?? MEMORY_TARGET_AGENT,
    content: body.content,
    source: 'memory',
  });
  res.status(201);
  ok(res, toDto(row));
}));

// Forget a learned memory. deleteInstruction is owner-scoped; 404 on wrong tenant / missing.
memoryRouter.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await deleteInstruction(req.params.id, req.userId!))) return fail(res, 404, 'memory_not_found');
  res.status(204).end();
}));
