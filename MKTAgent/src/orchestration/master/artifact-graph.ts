// Reverse index over the agent registry: artifact type → the single agent that produces it.
// This is the data the C1 backward-chaining planner (selectByTargets) consumes instead of a
// hardcoded marketing if-ladder, and the same lookup the P2 capability-gap detector will use to
// decide "no node produces artifact X". Built once at module load; asserts a SINGLE producer per
// artifact type (two producers would make backward selection ambiguous → a registry authoring bug).
import { AGENTS } from '../registry/agent-registry.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import type { ArtifactType } from '../schemas/artifact-schemas.ts';

const PRODUCER = new Map<ArtifactType, RunnableAgentId>();
for (const agent of AGENTS) {
  for (const type of agent.produces) {
    const existing = PRODUCER.get(type);
    if (existing && existing !== agent.id) {
      throw new Error(
        `artifact-graph: artifact "${type}" is produced by both "${existing}" and "${agent.id}" — ` +
          'backward-chaining selection requires exactly one producer per artifact type.',
      );
    }
    PRODUCER.set(type, agent.id);
  }
}

// The agent that produces `type`, or undefined when nothing in the registry does (a capability gap).
export const producerOf = (type: ArtifactType): RunnableAgentId | undefined => PRODUCER.get(type);

// Whether any registry agent produces `type`. Used by the capability-gap path (Phase 02).
export const hasProducer = (type: ArtifactType): boolean => PRODUCER.has(type);
