// Vision agents (Atria roadmap) — DISPLAY-ONLY roster for the command-center "Neural
// Network" view. These are the Atria agents not yet in the runnable registry (no runner,
// no DAG wiring). Kept in a SEPARATE list on purpose: they are NOT in `AGENTS` and their
// ids are NOT in `RunnableAgentId`, so the planner/executor/type system never sees them —
// zero risk of colliding with a live agent node. The `/orchestration/agents` endpoint
// appends them flagged `planned`; the UI renders them dimmed + non-clickable ("coming
// soon") so nothing implies they run. Personas mined from `agency-agents` (see
// docs/agency-agents-attribution.md); grouping follows the Atria command-center taxonomy.
import type { AgentGroupId } from './agent-groups.ts';

export interface VisionAgent {
  id: string;
  name: string;
  description: string;
  emoji: string;
  group: AgentGroupId;
  vibe: string;
  // Most vision agents are 'planned' (dimmed "soon" node). One that has shipped a real SURFACE
  // (not a DAG runner) flips to 'live' + names its Command-Center panel via `surface`, so the node
  // becomes clickable and opens that panel instead of the "coming soon" toast. Memory is the first.
  implStatus?: 'planned' | 'live';
  surface?: string;
}

export const VISION_AGENTS: VisionAgent[] = [
  {
    id: 'memory',
    name: 'Memory Agent',
    description: 'Learns your copy style from the posts you edit, then teaches it to every future draft.',
    emoji: '🧠',
    // Assistant: the cross-cutting store every other agent reads/writes (Trợ lý).
    group: 'assistant',
    vibe: 'An archivist who turns your edits into reusable style Atria remembers.',
    // P2-2a: shipped as a real Command-Center surface (learn→propose→approve→apply).
    implStatus: 'live',
    surface: 'memory',
  },
  {
    id: 'lead_collector',
    name: 'Lead Collector Agent',
    description: 'Scores inbound comments, captures opt-in leads, routes qualified ones to sales.',
    emoji: '🎯',
    group: 'action',
    vibe: 'A classifier who captures qualified leads and never wastes a sales cycle.',
  },
  {
    id: 'analytics',
    name: 'Analytics Agent',
    description: 'Turns raw per-platform metrics into campaign wins and clear next moves.',
    emoji: '📊',
    group: 'intelligence',
    vibe: 'A data storyteller who reads the numbers and names the next move.',
  },
  {
    id: 'email',
    name: 'Email Campaign Agent',
    description: 'Builds email sequences — urgency, per-segment personalization, click-through focus.',
    emoji: '📧',
    group: 'action',
    vibe: 'An email copywriter who personalizes at scale and measures every click.',
  },
];
