// Instruction repo (Atria Phase 02). Owner-scoped CRUD over the user's layered "Atria
// Instructions" (workspace → campaign → post, optionally agent-targeted). Small per tenant;
// resolveInstructions reads the whole set for an owner and composes it per run.
import { prisma } from '../client.ts';
import type { Instruction, InstructionScope, InstructionSource } from '../../../prisma/generated/prisma/client.ts';

export interface InstructionInput {
  ownerId: string;
  scope: InstructionScope;
  scopeRefId?: string | null; // required for campaign/post; null/absent for workspace
  agentId?: string | null;
  content: string;
  enabled?: boolean;
  source?: InstructionSource; // defaults to 'user'
}

export const createInstruction = (input: InstructionInput): Promise<Instruction> =>
  prisma.instruction.create({
    data: {
      ownerId: input.ownerId,
      scope: input.scope,
      scopeRefId: input.scopeRefId ?? null,
      agentId: input.agentId ?? null,
      content: input.content,
      enabled: input.enabled ?? true,
      source: input.source ?? 'user',
    },
  });

// List all of an owner's instructions, optionally narrowed to one scope (+ ref). Newest-first
// for the editor; resolveInstructions does its own ordering for prompt composition.
export const listInstructions = (
  ownerId: string,
  filter?: { scope?: InstructionScope; scopeRefId?: string | null },
): Promise<Instruction[]> =>
  prisma.instruction.findMany({
    where: {
      ownerId,
      ...(filter?.scope ? { scope: filter.scope } : {}),
      ...(filter?.scopeRefId !== undefined ? { scopeRefId: filter.scopeRefId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });

export const getInstruction = (id: string, ownerId: string): Promise<Instruction | null> =>
  prisma.instruction.findFirst({ where: { id, ownerId } });

// Scoped update — only provided fields change. Returns null when not found / wrong tenant.
export const updateInstruction = async (
  id: string,
  ownerId: string,
  patch: Partial<Pick<InstructionInput, 'content' | 'enabled' | 'agentId' | 'source'>>,
): Promise<Instruction | null> => {
  const r = await prisma.instruction.updateMany({
    where: { id, ownerId },
    data: {
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
    },
  });
  return r.count === 1 ? getInstruction(id, ownerId) : null;
};

export const deleteInstruction = async (id: string, ownerId: string): Promise<boolean> => {
  const r = await prisma.instruction.deleteMany({ where: { id, ownerId } });
  return r.count === 1;
};

// Raw read used by resolveInstructions: every ENABLED instruction for an owner. The set is small
// (a handful per tenant), so composition filters + orders in memory rather than per-run querying.
export const listEnabledInstructionsForOwner = (ownerId: string): Promise<Instruction[]> =>
  prisma.instruction.findMany({ where: { ownerId, enabled: true } });
