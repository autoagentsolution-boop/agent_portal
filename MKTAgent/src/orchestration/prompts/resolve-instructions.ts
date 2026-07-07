// resolveInstructions — compose the user's layered "Atria Instructions" for one agent run.
//
// Mirrors resolveCopyConfig's inheritance: most-general → most-specific so a later (more
// specific) instruction is READ LAST by the model and refines the earlier ones. Order:
//   workspace(all-agents) → workspace(this-agent) → campaign(all) → campaign(this-agent)
//   → post(all) → post(this-agent)
// Only enabled instructions that apply to THIS run (matching campaign/post) and THIS agent
// (agentId null = all agents, or exactly this agentId) are included. Returned as plain strings;
// buildAgentPrompt wraps them in the delimited "USER INSTRUCTIONS" block (guardrails still win).
import { listEnabledInstructionsForOwner } from '../../db/repos/instruction-repo.ts';
import type { Instruction } from '../../../prisma/generated/prisma/client.ts';

export interface InstructionResolveCtx {
  ownerId: string;
  agentId?: string | null;   // the agent whose prompt is being built (registry agentId)
  campaignId?: string | null;
  postId?: string | null;
}

const SCOPE_RANK: Record<Instruction['scope'], number> = { workspace: 0, campaign: 1, post: 2 };

// Does this instruction apply to the current run's scope target?
const appliesToScope = (i: Instruction, ctx: InstructionResolveCtx): boolean => {
  if (i.scope === 'workspace') return true;
  if (i.scope === 'campaign') return Boolean(ctx.campaignId) && i.scopeRefId === ctx.campaignId;
  if (i.scope === 'post') return Boolean(ctx.postId) && i.scopeRefId === ctx.postId;
  return false;
};

// Does this instruction apply to the current agent? Null agentId = all agents.
const appliesToAgent = (i: Instruction, ctx: InstructionResolveCtx): boolean =>
  i.agentId == null || (Boolean(ctx.agentId) && i.agentId === ctx.agentId);

export async function resolveInstructions(ctx: InstructionResolveCtx): Promise<string[]> {
  const all = await listEnabledInstructionsForOwner(ctx.ownerId);
  return all
    .filter((i) => appliesToScope(i, ctx) && appliesToAgent(i, ctx))
    .sort((a, b) => {
      const s = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
      if (s !== 0) return s;
      // general (all-agents) before agent-specific within a scope level
      const ar = (a.agentId == null ? 0 : 1) - (b.agentId == null ? 0 : 1);
      if (ar !== 0) return ar;
      return a.createdAt.getTime() - b.createdAt.getTime(); // stable, deterministic
    })
    .map((i) => i.content.trim())
    .filter(Boolean);
}
