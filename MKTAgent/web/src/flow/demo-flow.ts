// Demo-mode copy for the Safe/Live publish toggle. The old hardcoded brandingVideoFlow
// template + its FlowTemplate/FlowAgentNode types were retired with the pre-Atria flow UI
// (FlowCanvas/FlowCoachPanel/WorkspaceHero/AgentCatalogPreview). Only the DemoMode contract
// survives — it still drives DemoModeToggle and the safe-publish gate.
export type DemoMode = 'safe' | 'live';

export const demoModeCopy: Record<DemoMode, { title: string; detail: string }> = {
  safe: {
    title: 'Safe Simulation',
    detail: 'Generate/review is live, but live social publishing is blocked from the UI to avoid accidental Meta posts.',
  },
  live: {
    title: 'Live Publish',
    detail: 'Publish-now is enabled and will call connected social platforms. Use only for one controlled demo post.',
  },
};
