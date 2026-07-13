# Feature Map

Living record of features shipped and their real relationships in the app. Each commit appends a stub below; the model curates the relationships.

## Features & relationships

### Command Center: 2-tier grouped agent constellation (`93d3cdd`)
The flat ~17-node ring was cluttered; now Atria → group → agent renders as a collapsible hierarchy, default collapsed to 5 group nodes.
- **Taxonomy (display metadata ONLY):** re-split `agent-groups.ts` from 3 groups (the old "Action" held 8) into 5 phase-based groups — 🧠 Intelligence(4), 🎨 Creative(5), 📢 Delivery(2), 📊 Insight & Growth(4), ⚙️ Core(2: scheduler+summarize). Each runnable agent + vision agent reassigned. **Zero flow impact:** node selection keys on `produces`/`requires` (C1) and the thinking-budget policy (P6) keys on `agentId` — neither reads `group`, so golden 23/23 unaffected.
- **CC render (`command-center-page.tsx`):** default shows only the 5 group nodes (emoji + count) ringing Atria; clicking one expands its members fanned around THAT group node (new `groupGeo`/`memberGeo`); one open at a time; clicking Atria collapses. Reuses the existing energy-link/flow-dot system on both tiers (new `cc-flow-sub` dot for group→member) and the agent panel (`openAgent`) for member clicks. Consumes `GET /orchestration/agents` (`groups` + per-agent `group`), unchanged contract.

### Composable planner — backward-chaining selection (C1, `0295323`)
The planner selects agent nodes by **backward-chaining from requested output artifacts** instead of a marketing if-ladder.
- **Depends on:** the agent registry's `produces`/`requires` graph (`registry/agent-registry.ts`); a new single-producer reverse index (`master/artifact-graph.ts`).
- **How:** `targetsFromGoal` (the ONLY reader of `GoalSpec.outputs.*` flags) → `selectByTargets` (closes over producers/requires, returns canonical `PIPELINE_ORDER`).
- **Consumed by (unchanged behavior):** `master/master-agent.planFromGoal` (← router `POST /orchestration/runs`, `atria-tools.propose_workflow`), `master/plan-tiers.buildPlanTiers` (economy/balanced/full), `master/campaign-materializer` (per calendar slot). Node ORDER preserved so tier-card dedup stays stable.
- **Guarded by:** `verify-planner-golden` (23 cases incl. tiers + materializer). Publish-only still errors via flag-based `isPublishOnly`. Scheduler splice untouched.
- **Unlocks:** a scheduled email composes `email_writer → scheduler → email_agent` via artifact chaining — no `needsEmail` special-case; selection is now marketing-agnostic.

### Capability-gap handling — Atria honestly flags what it can't do (Phase 02, this commit)
When the user asks for a capability **no agent node produces**, Atria does not fake it or bend it into a marketing plan — it flags the gap as demand and tells the user honestly.
- **Depends on / REUSES (not a new table):** the existing `RoadmapDemand` mechanism (`mkt_roadmap_demand`, `db/repos/roadmap-demand-repo.ts`, `registry/roadmap-agents.ts` pitches, `registry/vision-agents.ts` surfaces). Extended with a nullable `spec Json?` column + `action: 'requested'`.
- **New:** brain tool `flag_capability_gap` (`atria/atria-tools.ts` + `prompts/atria-brain-prompt.ts`) → `recordCapabilityGap` (dedup via `wasRequested`) → `mkt_roadmap_demand` row with a drop-in spec (produces/requires/gate/example). Reply-only turn — sets NO workflow proposal.
- **Surfaced by:** `GET /atria/roadmap-demand` (owner-auth DEV backlog), alongside `/atria/roadmap` + `/atria/suggestions`.
- **Complements C1:** C1 composes EXISTING nodes; this is the honest fallback when NONE produces the needed artifact. The `spec` maps 1:1 to a registry `AgentDefinition`, so a dev scaffolds the node (registry + runner) with no planner change.
- **Guarded by:** `verify-capability-gap` (repo round-trip + dedup + brain dispatch); `verify-atria-suggestions` confirms the pitched/accepted path is unregressed.

### `summarize` — first non-marketing capability node, reachable + composable (Phase 05, this commit)
Proves the composable-agent thesis end-to-end: a real capability drops in with **only a registry entry + a runner**, is reachable from chat, composes with other nodes, and runs — with the marketing path untouched.
- **The node:** `registry/agent-registry.ts` (`summarize`: produces `summary`, requires `[]` — reads source from the goal like `email_writer`) + `executor/agent-runners.ts` `runSummarize` (Gemini → `{summary, bullets}`) + `schemas/artifact-schemas.ts` `summary` type. **No planner change** — this is the whole point.
- **Reachability (the seam that avoids a thin layer):** new `GoalSpec.taskTargets` (a general escape hatch from marketing flags) short-circuits `targetsFromGoal` → `selectByTargets` picks the node by its output. Brain tool `propose_task(capability, source_text)` (`atria-tools.ts`, map `TASK_CAPABILITIES`) builds a task goal and plans it via `master-agent.planFromGoal(goal, {skipClarification})` — skips the marketing clarification engine. Marketing goals never set `taskTargets`, so the golden 23/23 is unaffected.
- **Composition:** `email_writer.optional` now includes `summary`, so `taskTargets:['summary','email_result']` composes `summarize → email_writer → email_agent` (deriveDeps wires the edge; email_writer grounds the email on the summary).
- **Relationship to C1 + capability-gap:** C1 made selection target-driven so this composes with zero planner edits; capability-gap (P2) would have flagged "summarize" as missing — building it via the drop-in recipe **closes that loop** (gap → authored node → reachable). `TASK_CAPABILITIES` is where the next utility (translate, transcribe…) plugs in.
- **Guarded by:** `verify-summarize-node` (planner compose + runner + brain seam + **real executor run** producing a stored `summary` artifact); golden 23/23 + email/scheduler/capability-gap verifies unregressed.

### Atria brain reliability — explicit thinking budget (fix, this commit)
Fixes spurious "sorry, I ran into a problem" replies. `gemini-2.5-flash`'s **default dynamic thinking** misbehaves with tools — it intermittently returns `finishReason=STOP` with EMPTY content parts, which the brain loop reads as a failed turn. Setting an **explicit** `thinkingConfig.thinkingBudget` (4096) in `atria-brain.ts` `doCall` fixes it deterministically while KEEPING real reasoning (the model self-limits below the ceiling). Measured: default → empty every time; explicit budget → a clean tool-call/reply every time. Baseline of a coming **per-agent-group thinking-budget policy** (see `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`).

### Per-agent-group thinking-budget policy (P6, `f2c9f98`)
Generalizes the brain fix above into a per-node policy: one module maps each registry agentId to its gemini-2.5 `thinkingBudget` ceiling — reasoning nodes 4096, creative nodes scaled by a new `goal.qualityPref`, `summarize` scaled by source length, action nodes 0. The budget is a CEILING (the model self-limits below it), so a generous value is ~free on easy turns.
- **Depends on:** the explicit-brain-budget fix (`b5c4f9c`) that established WHY (dynamic thinking + tools → empty replies); the `llm-json` seam (`callGeminiJson` now takes `opts.thinkingBudget`); `GoalSpec` (new `qualityPref` — additive, nullish-safe, so old persisted `wf_run.goal` rows default cleanly).
- **How (the zero-per-runner trick):** `agent-executor.executeNode` computes `thinkingBudgetFor(agentId, ctx)` and binds it onto `ctx.llmJsonFn` — but ONLY when the seam is the real call (a DRY-RUN stub sets `llmJsonFn`, so verification's no-spend/no-network contract is preserved). Every `ctx.llmJsonFn ?? callGeminiJson` runner (`ideation`, `strategy`, `campaign_strategist`, `email_writer`, `summarize`, `storyboard`/`video` planning) inherits its budget automatically. `atria-brain.doCall` reads the shared `BRAIN_THINKING_BUDGET`.
- **Flows touched:** intake — `requirement-analyzer` + `deterministic-analyzer` detect a stated quality preference conversationally ("chất lượng cao"/"high quality" → high; "nhanh"/"tiết kiệm" → economy) → any orchestration run applies the per-node budget on the wire.
- **Deliberately NOT touched:** node SELECTION (golden 23/23 unchanged — `qualityPref`/budget never change which nodes run) and copygen (`concept_writer` keeps `thinkingBudget:0`, the hard-won JSON-truncation fix), so the creative tier effectively lands on `email_writer`. `memory`/`analytics` seams are outside the runner map (default budget; dynamic growth deferred).
- **Guarded by:** `verify-thinking-budget` (25 checks: policy math + `callGeminiJson` body + real executor run proving the budget reaches the wire per node + DRY-RUN pass-through); golden 23/23 + summarize regression green.

### Task-seam hardening across refine/clarify (`81d4d86`)
Closes the one real gap found when rescanning whether P3/P4 (general `WorkflowProposal`/`TaskSpec`) were needed — they are not; the shipped `taskTargets` seam just had two marketing-shaped leaks on a follow-up turn.
- **Strengthens:** the `summarize` task seam (P5) and the P6 `qualityPref` field. `goal-merge.mergeGoals` now preserves `taskTargets`, `slots.sourceText`, and `qualityPref` (the last was a deterministic P6 regression — a stated "high quality" reset to 'standard' on the next marketing refine). `clarification-engine.evaluateClarification` early-returns `ready` for any `taskTargets` goal (it carries its own inputs; the runner enforces sufficiency), so a task never gets marketing questions even on the LLM-misroute path — making `propose_task`'s `skipClarification` defense-in-depth.
- **Blast radius:** none for marketing (goals never set `taskTargets` → golden 23/23 byte-identical). **Defers:** P3/P4 remain YAGNI; revive trigger = a 2nd `TASK_CAPABILITIES` entry or real multi-turn task refinement.
- **Guarded by:** `verify-master` (task-goal survives merge + still selects `summarize`; `qualityPref` survives refine; a new stated pref wins).

### Scheduled email: confirmed schedule persists across turns (`0f89f51`)
Fixes a birthday email + "tomorrow morning" planning as `email_writer → email_agent` with no `scheduler` node. The splice (`workflow-planner`) and carry-via-`priorGoal` were correct; the schedule was never persisted because `set_schedule` wrote to a turn-scoped `ctx.scheduleProposal` that only lands on a run if `propose_workflow` runs the same turn — and the tool note told the model to defer it (contradicting the system prompt).
- **Depends on:** the generic-scheduler node + `email_writer→scheduler→email_agent` composition (Composable planner C1). **Touches:** `atria-tools` (set_schedule guidance), `conversation-author` (now surfaces `schedule{at,timezone,confirmed}` so the reply reads the time back to confirm), `conversation-prompt`.
- **Guarded by:** `verify-master` (merge keeps `schedule.at`+`needsEmail`; confirmed goal splices `scheduler` before `email_agent`; reply asks to confirm).

### Content language mirrors the chat (`bc2c60d`)
Fixes an English conversation producing a Vietnamese email. Content generators resolved language via `goal.slots.language` (a stale 'vi' inferred from recalled memory) → `user.defaultLanguage` → `DEFAULT_LANGUAGE='vi'` — the same untrustworthy signal the chat reply already stopped using.
- **Depends on:** `detect-language`; new `contentLanguageFor(message, prior)` derives the run's language from the actual message + the flow's established prior, never the analyzer's inferred slot. **Used by:** `atria-tools` `propose_workflow` + `propose_task` (sets `goal.slots.language`), consumed downstream by `resolveRunLanguage` (email/copy/media). **Also:** `clarification-engine` skips the platforms question for an email goal (mirrors the planner's `needsEmail` short-circuit); `atria-brain-prompt` reconciles the line-32/33 conflict so scheduling proposes even before the @ address is known.
- **Blast radius:** VN chats still produce VN content (detection catches accented + unaccented VN); golden 23/23. **Guarded by:** `verify-master` (+7: content mirrors chat / refine override / inferred-vi ignored; email goal never asks platforms).

### In-flight Atria runs resumable from the Command Center (`473875d`)
A non-marketing run (email/task) is a post-less `kind=instance`, so one paused at an approval gate surfaced nowhere (Saved Flows = templates, Scheduled = already-approved, Workspace = campaigns) — reachable only by remembering its chat.
- **Depends on:** `getRunByChat`/`selectChat` (reopening a chat restores the paused flow card, any status). **Adds:** `listResumableRuns` + `GET /orchestration/runs/resumable`; the Command Center "Continue where you left off" cards render these as ⚡ status-labelled cards that resume via the run's chat (de-duped from the plain recent-chat list). **Complements:** the Scheduled page (a run moves there once approved → `scheduled`).

### Command Center voice launch + dismissable resume cards (`ab285f2`)
Two CC quality-of-life additions on top of the resume-cards feature.
- **Voice:** a 🎙️ button on the CC command bar opens Atria chat directly in hands-free voice mode. Reuses the OrchestratePanel voice stack (`useSpeechRecognition` + `tts-player` + `voiceMode`) via a new `autoVoice` prop that fires `toggleVoiceMode` on the false→true edge (the panel isn't remounted per open, so it watches the flag). `App.launchVoice` sets it; every other open path (`openOrchestrate`/`launchFromCommandCenter`/`selectChat`/`closeCcChat`) clears it. Gated on Web Speech API support.
- **Dismiss:** each "Continue where you left off" card gets a ✕ that deletes the underlying item — chat → `DELETE /agent/chats/:id`, run/flow → `DELETE /orchestration/runs/:id` (a `running` run refuses 409 rather than orphaning its executor) — then refreshes the affected list. Depends on the resume-cards feature (`473875d`); the card is wrapped so the ✕ is a sibling, not a nested `<button>`.

## Commit ledger

- **fix(orchestration): preserve email intent + recipient name across refine/confirm turns** (0733288)
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
- **chore(hooks): test-integrity gate + feature-ledger on commit** (7a19654)
  - `.claude/hooks/feature-ledger.cjs`
  - `.claude/hooks/test-integrity-guard.cjs`
  - `.claude/hooks/test-integrity-stop.cjs`
  - `.claude/settings.json`
  - `docs/feature-map.md`
- **docs(plan): final composable-planner plan (Track A / P1b)** (4cd7aa6)
  - `plans/260712-1649-atria-composable-planner/phase-01-c1-backward-chaining.md`
  - `plans/260712-1649-atria-composable-planner/phase-02-capability-gap-devnotify.md`
  - `plans/260712-1649-atria-composable-planner/phase-03-c2-workflow-proposal.md`
  - `plans/260712-1649-atria-composable-planner/phase-04-c3-taskspec.md`
  - `plans/260712-1649-atria-composable-planner/phase-05-node-authoring-verify.md`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **test(orchestration): expand planner golden-master to tiers + materializer slots** (6047d18)
  - `MKTAgent/src/orchestration/planner-golden-snapshot.json`
  - `MKTAgent/src/orchestration/verify-planner-golden.ts`
- **refactor(orchestration): backward-chaining agent selection (C1)** (0295323)
  - `MKTAgent/src/orchestration/master/artifact-graph.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `docs/feature-map.md`
- **feat(orchestration): capability-gap handling — Atria honestly flags missing capabilities (P2)** (2861dbe)
  - `MKTAgent/prisma/migrations/20260712112702_add_capability_gap_spec/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/atria-router.ts`
  - `MKTAgent/src/db/repos/roadmap-demand-repo.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-capability-gap.ts`
  - `docs/feature-map.md`
- **feat(orchestration): summarize node — first non-marketing capability, reachable + composable (P5)** (caa2d27)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/master-agent.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `docs/feature-map.md`
- **docs(plan): mark P1/P2/P5 done, P3/P4 superseded by lightweight task seam** (bdef900)
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **fix(orchestration): explicit brain thinking budget — stop spurious empty-reply apologies** (b5c4f9c)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `docs/feature-map.md`
- **docs(plan): phase-06 per-agent-group thinking-budget policy (design locked)** (0c8c883)
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`
- **feat(orchestration): per-agent-group thinking-budget policy (P6)** (f2c9f98)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/executor/agent-executor.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/llm-json.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/thinking-budget.ts`
  - `MKTAgent/src/orchestration/verify-thinking-budget.ts`
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`
- **docs(feature-map): describe P6 thinking-budget policy relationships** (a9aac26)
  - `docs/feature-map.md`
- **docs(feature-map): move P6 relationships into curated section** (cec3b83)
  - `docs/feature-map.md`
- **fix(orchestration): harden non-marketing task seam across refine/clarify** (81d4d86)
  - `MKTAgent/src/orchestration/master/clarification-engine.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **docs(feature-map): task-seam hardening relationships** (90de7a9)
  - `docs/feature-map.md`
- **fix(orchestration): persist confirmed schedule so email flow splices the scheduler node** (0f89f51)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/conversation-author.ts`
  - `MKTAgent/src/orchestration/prompts/conversation-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **fix(orchestration): content language mirrors the chat; email-aware clarification; reconcile scheduling prompt** (bc2c60d)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/clarification-engine.ts`
  - `MKTAgent/src/orchestration/master/detect-language.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **feat(orchestration): surface in-flight Atria runs in Command Center resume cards** (473875d)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/db/repos/workflow-run-repo.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
- **docs(feature-map): curate schedule-persistence, content-language, resume-cards relationships** (a345669)
  - `docs/feature-map.md`
- **feat(web): Command Center voice launch + dismissable resume cards** (ab285f2)
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **docs(feature-map): CC voice launch + dismissable resume cards relationships** (6013881)
  - `docs/feature-map.md`
- **feat(cc): collapsible 2-tier agent constellation grouped by function** (93d3cdd)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/orchestration/registry/agent-groups.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/vision-agents.ts`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **docs(feature-map): 2-tier grouped constellation relationships** (acf8985)
  - `docs/feature-map.md`
- **fix(cc): member labels no longer overlap when a group expands** (08c7efb)
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **feat(web): default UI copy to English; declutter + fix Command Center constellation** (549925c)
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/impact-report.tsx`
  - `MKTAgent/web/src/components/orchestrate-run-cards.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/read-aloud-button.tsx`
  - `MKTAgent/web/src/components/scheduled-view.tsx`
  - `MKTAgent/web/src/components/top-nav.tsx`
  - `MKTAgent/web/src/components/workspace-menu.tsx`
  - `MKTAgent/web/src/components/workspace-panel.tsx`
- **fix(atria): stop campaign/flow intent confusion + inherit platforms** (5eeff26)
  - `MKTAgent/src/api/campaigns-router.ts`
  - `MKTAgent/src/api/orchestration-chat.ts`
  - `MKTAgent/src/orchestration/master/campaign-intent.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/verify-campaign-intent.ts`
  - `MKTAgent/src/orchestration/verify-campaign-platform-inherit-http.ts`
- **feat(atria): demo-readiness — instructions/memory in brain, email-by-name, voice one-button, strategist inline** (ae95f52)
  - `MKTAgent/src/api/memory-router.ts`
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/db/repos/lead-repo.ts`
  - `MKTAgent/src/memory/user-memory.ts`
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/prompts/resolve-instructions.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/verify-capability-gap.ts`
  - `MKTAgent/src/orchestration/verify-instructions-and-memory.ts`
  - `MKTAgent/src/orchestration/verify-nurture-email-from-chat.ts`
  - `MKTAgent/src/orchestration/verify-p6-seed-session.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/memory-panel.tsx`
  - `MKTAgent/web/src/components/orchestrate-run-cards.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/styles.css`
