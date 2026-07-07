# Merge Atria hub into the Master Agent (Atria = the Orchestrate chat)

## Problem
`AtriaHubPage` was built as a SEPARATE surface that only *launches* the real master
agent (`OrchestratePanel`). It has its own "Ask Atria" composer + reminders and forwards
text via `onPlanCampaign → launchFromCommandCenter`. Result: two adjacent sidebar entries
(`✦ Atria`, `✎ New chat`) that both greet the user and both carry a composer → duplicate.

Correct model (user): **Atria = the master agent itself.** Marketing strategist is a
*feature* of Atria (proactive reminders + campaign planning), not a separate agent/page.
"New chat" is just Atria with an empty conversation.

## Target IA
- ONE conversational surface named **Atria** (= `OrchestratePanel`).
- Its **empty-state** hosts the strategist Home: composer + starters + **Reminders**
  (`AtriaSuggestionCards`) + **Resume work** (`AtriaResumeWorkCards`). Starting a chat
  collapses them → normal conversation.
- `atria-hub-page.tsx` deleted. Child components kept, re-homed.
- **Instructions** and **Impact** become their own sidebar items (distinct tasks, not chat):
  `⚙ Instructions` → `InstructionEditor`; `📈 Impact` → `ImpactReport` (+`CampaignCommandView`).
- **Command Center** untouched this pass (separate review later).

## Decisions (confirmed)
- Instructions/Impact → dedicated sidebar entries (not tabs on the chat).
- Command Center → keep as-is, defer.

## Phases
- [ ] **Phase 01** — Frontend merge ([phase-01-frontend-merge.md](phase-01-frontend-merge.md))
  - Sidebar: drop `✎ New chat`, rename entry → `✦ Atria`; add `⚙ Instructions`, `📈 Impact`.
  - `OrchestratePanel` empty-state renders reminders + resume cards (new props: `chats`,
    `onResumeChat`); in-panel suggestion action calls `start()` directly (no cross-page hop).
  - Delete `atria-hub-page.tsx` + its App wiring (`page === 'atria'` branch, import).
  - Add `page === 'instructions'` / `'impact'` render branches.

## Key files
- `MKTAgent/web/src/App.tsx` — sidebar + page routing
- `MKTAgent/web/src/components/OrchestratePanel.tsx` — empty-state home
- `MKTAgent/web/src/components/atria-hub-page.tsx` — DELETE
- Reused as-is: `atria-suggestion-cards.tsx`, `atria-resume-work-cards.tsx`,
  `instruction-editor.tsx`, `impact-report.tsx`, `campaign-command-view.tsx`

## Non-goals
- No backend changes (routers/agents unchanged; strategist is already a feature layer).
- No Command Center rework.
- No new components — only re-home existing ones.

## Risks
- `OrchestratePanel` is keyed by `sessionId`; resume-chat → `selectChat` remounts — verify
  no stale prefill re-fires (memory: clear prefill on select/delete already handled in App).
- Empty-state must key off `!hasStarted` so cards vanish once a run starts.
