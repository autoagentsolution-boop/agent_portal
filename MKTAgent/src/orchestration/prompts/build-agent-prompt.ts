// buildAgentPrompt — the ONE composition point for every agent's system prompt.
//
// Layers, most-general → most-specific → hard:
//   1. EXPERT BASE      — persona + capabilities + quality bar, authored as registry
//                         `promptSections` data (prompt-as-data; expert grade).
//   2. LANGUAGE RULE     — the resolved run language (post → campaign → user chain).
//   3. USER INSTRUCTIONS — [Phase 02] the user's own layered "Atria Instructions",
//                          honored UNLESS they conflict with a hard contract rule.
//   4. OUTPUT CONTRACT   — the strict JSON shape + per-field rules (agent-prompts.ts),
//                          appended LAST so it wins over persona/instructions.
//
// This is the single seam Phase 02 injects user instructions into: every runner that
// builds an LLM system prompt goes through here, so a quality/instruction change lands
// across ideation, strategy, storyboard, the campaign strategist, etc. by construction.
import { getAgent } from '../registry/agent-registry.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { AGENT_OUTPUT_CONTRACTS, type ContractKey } from './agent-prompts.ts';

export interface PromptContext {
  // Resolved CONTENT language for this run (not the chat language). Drives the language rule.
  language: string;
  // Phase 02: the user's resolved instructions (workspace → campaign → post + agent-scoped),
  // already ordered most-general → most-specific. Empty/omitted in Phase 01.
  userInstructions?: string[];
  // Which output contract to use. Defaults to the agentId; the storyboard agent overrides it
  // ('storyboard' cinematic vs 'storyboard_carousel' swipeable) per the deliverable at run time.
  contractKey?: ContractKey;
}

export interface BuiltPrompt {
  system: string;
  // The hard output contract, exposed so callers/tests can assert it is present + last.
  contract: string;
}

const bullets = (items: string[]): string => items.map((s) => `- ${s}`).join('\n');

const languageRule = (language: string): string =>
  `LANGUAGE: write all user-facing text entirely in ${language}. Never use another language — not even the language of the product's name — and never mix languages. (Any enum/technical values are called out in the OUTPUT CONTRACT below and stay as specified there.)`;

const userInstructionBlock = (instructions: string[]): string =>
  [
    'USER INSTRUCTIONS (the user\'s own steer — honor these unless they conflict with a hard rule in the OUTPUT CONTRACT, which always wins):',
    bullets(instructions),
  ].join('\n');

// Build the full system prompt for an agent. `contractKey` in ctx overrides the default
// (agentId) — used by storyboard to pick its cinematic vs carousel output shape.
export function buildAgentPrompt(agentId: RunnableAgentId, ctx: PromptContext): BuiltPrompt {
  const sections = getAgent(agentId)?.promptSections;
  const key: ContractKey = ctx.contractKey ?? (agentId as ContractKey);
  const contract = AGENT_OUTPUT_CONTRACTS[key];
  if (!contract) throw new Error(`buildAgentPrompt: no output contract for '${key}' (agent '${agentId}')`);

  const parts: string[] = [];
  if (sections?.role) parts.push(sections.role);
  if (sections?.goal) parts.push(`Your objective: ${sections.goal}`);
  if (sections?.capabilities?.length) parts.push(`You are expert at:\n${bullets(sections.capabilities)}`);
  if (sections?.constraints?.length) parts.push(`Operating principles & quality bar:\n${bullets(sections.constraints)}`);

  parts.push(languageRule(ctx.language));
  if (ctx.userInstructions?.length) parts.push(userInstructionBlock(ctx.userInstructions));
  parts.push(contract);

  return { system: parts.join('\n\n'), contract };
}
