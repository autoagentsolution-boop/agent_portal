// The Safe/Live publish DemoMode contract. The old hardcoded brandingVideoFlow template + its
// FlowTemplate/FlowAgentNode types were retired with the pre-Atria flow UI (FlowCanvas/
// FlowCoachPanel/WorkspaceHero/AgentCatalogPreview). The toggle text itself comes from i18n
// (t('demo.mode.safe'/'demo.mode.live')), so only the DemoMode union survives — it types App
// state, DemoModeToggle, and the safe-publish gate at PostCard.
export type DemoMode = 'safe' | 'live';
