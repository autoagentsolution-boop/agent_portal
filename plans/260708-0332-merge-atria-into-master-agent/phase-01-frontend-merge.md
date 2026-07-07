# Phase 01 — Frontend merge

**Priority:** high · **Status:** planned
Collapse `✦ Atria` + `✎ New chat` into one conversational surface; promote Instructions/Impact.

## Related code files
- Modify: `MKTAgent/web/src/App.tsx`
- Modify: `MKTAgent/web/src/components/OrchestratePanel.tsx`
- Delete: `MKTAgent/web/src/components/atria-hub-page.tsx`
- Read (unchanged): `atria-suggestion-cards.tsx`, `atria-resume-work-cards.tsx`,
  `instruction-editor.tsx`, `impact-report.tsx`, `campaign-command-view.tsx`

## Steps

### 1. App.tsx — sidebar
- Delete the `✦ Atria` button (currently `App.tsx:303`, sets `page='atria'`).
- Rename `✎ New chat` (`:304`) → `✦ Atria`, keep `onClick={openOrchestrate}`. Its `active`
  test stays `page === 'orchestrate' && !activeChatId`.
- Add two items after it: `⚙ Instructions` (`setPage('instructions')`) and
  `📈 Impact` (`setPage('impact')`), same pattern as Usage/Connections.
- `+ New flow` / `+` affordances that call `openOrchestrate` still valid.

### 2. App.tsx — Page type + routing
- `Page` union: drop `'atria'`, add `'instructions' | 'impact'`.
- Remove `import { AtriaHubPage }` and the entire `page === 'atria'` branch (`:396-405`).
- Add branches:
  - `page === 'instructions'` → `<div className="master-home"><InstructionEditor scope="workspace" notify={show} /></div>`
  - `page === 'impact'` → `<div className="master-home atria-home-stack">` with
    `{activeCampaign && <><CampaignCommandView campaignId={activeCampaign}/><ImpactReport campaignId={activeCampaign}/></>}`
    then `<ImpactReport period="30d" />` (lift verbatim from old hub Impact tab).
- Add imports: `InstructionEditor`, `ImpactReport`, `CampaignCommandView`.
- Pass new props into `OrchestratePanel` (see step 3):
  `chats={chatSessions.map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}`
  and `onResumeChat={(id) => void selectChat(id)}`. `flowsWithoutStrategy` + `onOpenFlow`
  (=`openSavedFlow`) already available — wire `onOpenFlow` (currently NOT passed).

### 3. OrchestratePanel.tsx — empty-state Home
- New props: `chats: Array<{ id: string; title: string; updatedAt: string }>`,
  `onResumeChat: (id: string) => void`, `onOpenFlow: (runId: string) => void`
  (already declared for P6 save-offer — reuse for resume cards).
- Import `AtriaSuggestionCards`, `AtriaResumeWorkCards`.
- In the render, in the `!hasStarted` hero block (where `starters` chips render), append:
  ```tsx
  <section className="atria-home-stack">
    <h3 className="atria-section-title">Reminders from Atria</h3>
    <AtriaSuggestionCards notify={notify} onPlanCampaign={(t) => void start(t)} />
    <AtriaResumeWorkCards
      chats={chats.slice(0, 4)}
      flows={flowsWithoutStrategy.slice(0, 4)}
      onResumeChat={onResumeChat}
      onOpenFlow={onOpenFlow}
    />
  </section>
  ```
- In-panel suggestion action = `start(t)` directly (no `onPlanCampaign` cross-page hop /
  no prefill round-trip → removes stale-prefill risk).
- Guard: cards only when `!hasStarted` so they vanish once a run begins.

### 4. Delete atria-hub-page.tsx
- Remove file. Grep confirms only importer is App.tsx.

## Todo
- [ ] Sidebar: drop old Atria, rename New chat → Atria, add Instructions + Impact
- [ ] Page union + routing branches (instructions, impact); remove atria branch
- [ ] OrchestratePanel new props + empty-state reminders/resume cards
- [ ] Wire chats/onResumeChat/onOpenFlow from App
- [ ] Delete atria-hub-page.tsx
- [ ] `tsc` in web + `npm run build`

## Success criteria
- One `✦ Atria` sidebar entry opens the master-agent chat; empty-state shows composer +
  reminders + resume work; starting a chat hides them.
- `⚙ Instructions` and `📈 Impact` reachable as own pages; content identical to old tabs.
- No `atria-hub-page` references remain; `tsc` + build green.
- Command Center unchanged and still forwards commands into Atria.

## Risks / mitigation
- Remount on resume-chat: `selectChat` already clears prefill (`App.tsx:73`) — no re-fire.
- `ImpactReport`/`CampaignCommandView` prop shapes: copy exactly from old hub Impact tab.
