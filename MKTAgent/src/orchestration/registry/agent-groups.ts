// Agent groups (divisions taxonomy — Atria Phase 05-C, adapted from the
// `agency-agents` divisions.json idea: a small {label, emoji, color} per group).
// This is the container the "Neural Network" grouped view (Phase 04) renders from,
// and the `group` field on AgentDefinition points here. Pure data — no behaviour.
//
// Taxonomy by pipeline PHASE so the grouped command-center view stays legible (the old 3-group split
// left "Action" holding 8 nodes). Purely display metadata — node selection keys on produces/requires and
// the thinking-budget policy keys on agentId, so regrouping changes nothing about how flows run.
//   Intelligence   — think / research / plan
//   Creative       — produce the content (copy, media, email draft)
//   Delivery       — external actions: publish / send (the approval-gated steps)
//   Insight&Growth — signals + audience lifecycle (analytics, memory, leads, nurture)
//   Core           — reusable cross-flow primitives (scheduler, summarize) — Scheduler stands out here
export type AgentGroupId = 'intelligence' | 'creative' | 'delivery' | 'data' | 'core';

export interface AgentGroup {
  id: AgentGroupId;
  label: string;
  emoji: string;
  // Hex accent for the UI card/edge. Kept here so the registry stays the single
  // source of truth for how a group is drawn (no colour logic scattered in web).
  color: string;
}

export const AGENT_GROUPS: Record<AgentGroupId, AgentGroup> = {
  intelligence: { id: 'intelligence', label: 'Intelligence', emoji: '🧠', color: '#6366f1' },
  creative: { id: 'creative', label: 'Creative', emoji: '🎨', color: '#a855f7' },
  delivery: { id: 'delivery', label: 'Delivery', emoji: '📢', color: '#f59e0b' },
  data: { id: 'data', label: 'Insight & Growth', emoji: '📊', color: '#10b981' },
  core: { id: 'core', label: 'Core', emoji: '⚙️', color: '#06b6d4' },
};

export const getGroup = (id: AgentGroupId): AgentGroup => AGENT_GROUPS[id];
