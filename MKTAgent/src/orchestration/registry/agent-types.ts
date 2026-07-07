// Agent registry types (brief §2, §3, §11.10). An AgentDefinition is metadata
// only — the "capability menu" the rule-based planner selects from. The actual
// run function lives in executor/agent-runners.ts (Phase 4), keyed by `id`, so
// the registry stays a pure data description (testable without execution).
import type { ArtifactType } from '../schemas/artifact-schemas.ts';
import type { AgentGroupId } from './agent-groups.ts';

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
  // Which action gate this agent presents (autonomy-hardening Phase 01) — the SINGLE
  // source of truth a machine reads to know an agent pauses and WHY, replacing the
  // executor's hardcoded SELECTION_GATE set + `hasVideoNode` special-casing:
  //   'selection' — pauses AFTER executing so the user picks an output (concept versions).
  //   'cost'      — pauses BEFORE executing (expensive step, e.g. video) for a spend OK.
  //   'publish'   — pauses BEFORE the external write (publisher).
  //   undefined   — no gate; runs straight through.
  // Note this is orthogonal to `requiresApproval` (the executor's before-halt flag):
  // concept_writer has gate='selection' but requiresApproval=false because its pause is a
  // POST-execution park, not a pre-execution halt — that's what fixes the old display≠behavior
  // (a UI roster reads `gate` to show "pauses", not the misleading requiresApproval=false).
  gate?: 'selection' | 'cost' | 'publish';
  // Capability skills this agent provides (brief §11.5). The publisher declares
  // `social.post.*`; target platforms come from the GoalSpec and are resolved at
  // run time (capability-based planning), NOT modeled as separate DAG nodes.
  // Optional: non-capability agents omit it.
  capabilities?: string[];

  // ── Persona layer (Atria Phase 05-A) ──────────────────────────────────────
  // Declarative, self-documenting metadata adopted from the `agency-agents` persona
  // schema. ALL optional + additive: the DAG wiring above is untouched, existing
  // agents keep working, and the "Neural Network" grouped UI (Phase 04) renders these
  // straight from the registry. The Phase 02 agents are authored to this shape.
  emoji?: string;
  // Division this agent belongs to (drives the grouped view + card colour).
  group?: AgentGroupId;
  // One-line character/tone of the agent (shown on the card).
  vibe?: string;
  // What "good" looks like for this agent — a few short outcome statements.
  successMetrics?: string[];
  // How the agent decides (borrowed from agency-agents' Decision-Framework).
  decisionFramework?: string;
  // Structured prompt-as-DATA (Phase 05-A payoff): the prompt becomes registry data
  // instead of being buried in agent-runners.ts. NOT yet consumed by the runners
  // (they still use agent-prompts.ts) — populated incrementally; a later pass can
  // generate the runner's system prompt from these sections. Kept optional so no
  // existing agent is forced to migrate at once.
  promptSections?: PromptSections;
}

export interface PromptSections {
  role?: string;
  goal?: string;
  capabilities?: string[];
  constraints?: string[];
}
