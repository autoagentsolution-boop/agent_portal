// Roadmap agents (Atria Phase 06) — the not-yet-built agents Atria KNOWS about and PITCHES when a
// triggering signal fires. Formalizes the display-only vision-agents (see vision-agents.ts) into a
// structured roadmap the suggestion engine reasons over: each carries what it WOULD do + the signal
// that should surface it. Pitching + accepting is logged (RoadmapDemand) as real demand for the team.
// NONE of these are runnable — no runner, no DAG, not in RunnableAgentId. Atria sells them, honestly.
export interface RoadmapAgent {
  id: string; // matches a vision-agents id where one exists
  name: string;
  whatItWouldDo: string;
  triggerSignal: string; // human-readable reason it would be pitched
}

export const ROADMAP_AGENTS: RoadmapAgent[] = [
  {
    id: 'email',
    name: 'Email Campaign Agent',
    whatItWouldDo: 'Nurture the leads you capture with automated, on-brand email sequences so no qualified lead goes cold.',
    triggerSignal: 'leads captured but no email follow-up capability',
  },
  {
    id: 'memory',
    name: 'Memory Agent',
    whatItWouldDo: 'Learn your edits and what performs, then auto-refine your content instructions so every post lands right the first time.',
    triggerSignal: 'you keep re-editing the generated content',
  },
  {
    id: 'analytics',
    name: 'Analytics Agent',
    whatItWouldDo: 'Pull real reach and engagement from platform Insights to prove impact and tell you what to do more of.',
    triggerSignal: 'you want real performance metrics beyond cost + leads',
  },
];

export const getRoadmapAgent = (id: string): RoadmapAgent | undefined => ROADMAP_AGENTS.find((a) => a.id === id);
