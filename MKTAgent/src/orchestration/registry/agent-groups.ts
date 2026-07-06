// Agent groups (divisions taxonomy — Atria Phase 05-C, adapted from the
// `agency-agents` divisions.json idea: a small {label, emoji, color} per group).
// This is the container the "Neural Network" grouped view (Phase 04) renders from,
// and the `group` field on AgentDefinition points here. Pure data — no behaviour.
//
// Mapping to the Atria command-center mockup's Vietnamese grouping:
//   Intelligence = "Nhóm Trí tuệ"  (think/plan/research/score)
//   Action       = "Nhóm Hành động" (write/produce media/publish/collect)
//   Assistant    = "Trợ lý"         (orchestrator + helper agents, not in the runnable registry)
export type AgentGroupId = 'intelligence' | 'action' | 'assistant';

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
  action: { id: 'action', label: 'Action', emoji: '⚡', color: '#f59e0b' },
  assistant: { id: 'assistant', label: 'Assistant', emoji: '🤝', color: '#10b981' },
};

export const getGroup = (id: AgentGroupId): AgentGroup => AGENT_GROUPS[id];
