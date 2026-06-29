// Agent registry types (brief §2, §3, §11.10). An AgentDefinition is metadata
// only — the "capability menu" the rule-based planner selects from. The actual
// run function lives in executor/agent-runners.ts (Phase 4), keyed by `id`, so
// the registry stays a pure data description (testable without execution).
import type { ArtifactType } from '../schemas/artifact-schemas.ts';

export type AgentId =
  | 'ideation'
  | 'strategy'
  | 'content_search'
  | 'concept_writer'
  | 'infographic'
  | 'storyboard'
  | 'video';

export type RunnableAgentId = AgentId | 'publisher';

// M1 status: live = wraps an existing production seam; stub = emits a schema-valid
// placeholder artifact so the DAG runs end-to-end now. Wiring stubs→live is later.
export type AgentImplStatus = 'live' | 'stub';

export interface AgentDefinition {
  id: RunnableAgentId;
  name: string;
  description: string;
  implStatus: AgentImplStatus;
  // Artifact types this agent needs upstream. Empty = a source node (no deps).
  // Optional inputs (e.g. research_summary for concept_writer) live in `optional`.
  requires: ArtifactType[];
  optional: ArtifactType[];
  // Artifact types this agent emits. The planner matches these against downstream
  // `requires` to derive depends_on edges; the executor validates output against
  // the matching artifact schema.
  produces: ArtifactType[];
  // brief §11.10 — included now so the later connector milestone is additive.
  // M1: only `publisher` requires a connection / external-write approval.
  requiresConnection: boolean;
  requiresApproval: boolean;
  // Capability skills this agent provides (brief §11.5). The publisher declares
  // `social.post.*`; target platforms come from the GoalSpec and are resolved at
  // run time (capability-based planning), NOT modeled as separate DAG nodes.
  // Optional: non-capability agents omit it.
  capabilities?: string[];
}
