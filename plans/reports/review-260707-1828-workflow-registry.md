# Workflow-Planning + Agent-Registry Review — Autonomy Prep

READ-ONLY senior review. Scope: planner (goal→plan→DAG), agent registry, node→runner binding,
template/instance drift, display-vs-runnable. Focus = where a MACHINE driving end-to-end
(goal→plan→execute→approve→publish, no human clicks) misfires.

Repo: `MKTAgent/src/orchestration/*`. Date 2026-07-07.

---

## 1. Agent registry table

Runner column = has an entry in `agent-runners.ts` `runners` map. "spends" = makes a real paid
provider call in its runner (records to ledger). Selection-gate = pauses the run AFTER it runs.

| agentId | requiresApproval (registry) | spends? | assets produced | has runner? | selection gate? |
|---|---|---|---|---|---|
| ideation | false | yes (LLM) | campaign_ideas | yes | no |
| strategy | false | yes (LLM) | strategy_brief | yes | no |
| content_search | false | **yes** (LLM + $0.035 grounding) | research_summary | yes | no |
| concept_writer | false | yes (LLM copy-gen) | content_concept | yes | **YES** |
| infographic | false | yes (image ~$0.04) | infographic_brief | yes | no |
| storyboard | false | yes (image ×N) | storyboard | yes | no |
| video | **true** (BEFORE cost gate) | yes (Veo/s + TTS) | video_prompt | yes | no |
| publisher | **true** (external-write) | $0 | publish_result | yes | no |

Vision agents (display-only, `vision-agents.ts`, served by `/orchestration/agents` flagged
`planned`): `memory`, `lead_collector`, `analytics`, `email` — NOT in `RunnableAgentId`, NOT in
`AGENTS`, NO runner. Planner/executor never see them (safe by construction).

Every runnable agentId has a runner; every runner has a registry+plan-schema entry. No orphans in
the node→runner dispatch (`agent-executor.executeNode` → `getRunner`). Dispatch binding is sound.

---

## 2. Prioritized findings (most severe first)

### F1 — HIGH · autonomy-hazard/bug · carousel publisher has NO data-dependency edge on storyboard
`workflow-planner.ts:19-40` (selectAgents) + `agent-registry.ts:150` (publisher.optional).
publisher `requires:[content_concept]`, `optional:[infographic_brief, video_prompt]`. For a
**carousel** plan (needsStoryboard=true, needsVideo=false) the media lands via
`attachPostMedia(...,'carousel',...)` INSIDE `runStoryboard` (`agent-runners.ts:581-584`), and
storyboard emits the `storyboard` artifact — which publisher does **not** list in
requires/optional. So `deriveDeps` builds NO edge publisher←storyboard. The DAG only runs
storyboard-before-publisher by **incidental node insertion order** (topo FIFO), not by dependency.
The video path is safe (publisher←video via `video_prompt`); infographic is safe (via
`infographic_brief`); **only carousel/storyboard is unguarded**. The executor comments explicitly
anticipate future parallel branches (`workflow-executor.ts:218-238`). Once execution is not strictly
serial — or if selection order ever changes — publisher can fire before the carousel media is
attached → **publish with missing/empty media**. Why it matters: a machine that plans carousels will
eventually publish blank posts with no human to catch it. Fix direction: model the media artifact as
a real publisher input (add `storyboard` to publisher.optional so the edge is derived).

### F2 — HIGH · autonomy-hazard/inconsistency · fresh-goal runs can NEVER auto-publish (and never media-gate)
`workflow-executor.ts:126` fetches `attachedPost = getPostByRunId(runId)` ONCE at run start. On a
**fresh goal run** (chat → planned → execute) no Post exists yet — `concept_writer` create-path
materializes it mid-run (`agent-runners.ts:204-216`). So `attachedPost` is null for the whole run.
Consequences: (a) the auto-publish waiver at `:255-261` guards on `!!attachedPost` → false →
`requiresApproval` stays true → **publisher ALWAYS halts** even with autoPublish=true; (b)
`neededAssets=[]` (`:132`) → media gating disabled → every planned media node runs (may spend on
video/carousel the deliverable didn't need). Only **template-instance** runs (post pre-exists) get
the waiver + gating. Why it matters: Atria driving fresh goals gets a mandatory human halt at
publish on every run — the "no clicks" goal is unreachable for the primary path. The auto-publish
machinery only works for the flow-as-template path.

### F3 — HIGH · autonomy-hazard · clarification gate has no autonomous bypass
`master-agent.ts:23-33` (planFromGoal) unconditionally runs `evaluateClarification`; every entry
path (`handle`, `refine`) funnels through it. `clarification-engine.ts:58-172` returns
`needs_clarification` with **required** questions whenever product is thin, no output flag is set,
or publishing has no platform (`:134` — platforms are NEVER silently defaulted, by design). There is
no flag to let a machine proceed on best-effort/inferred slots. Why it matters: for Atria to drive
goal→plan with no human, any under-specified goal dead-ends at `awaiting_clarification` and never
produces a DAG. Autonomy needs either an Atria-side slot-filler feeding a complete GoalSpec, or a
"plan anyway with defaults" mode. Today neither exists.

### F4 — HIGH · autonomy-hazard · any video plan double-gates with no override
`workflow-executor.ts:113` `hasVideoNode` forces `autoPublish=false` unconditionally (`:253`), AND
`video.requiresApproval=true` is read from the LIVE registry (`:243`) as a hard BEFORE-gate. So a
plan containing video ALWAYS halts twice for a human (video cost gate, then publisher), and
`opts.autoPublish` cannot waive either. There is no parameter to auto-approve the video cost gate.
Why it matters: Atria cannot autonomously produce-and-publish video content at all — the exact
"video content farm" pivot the branch is named for requires manual approval on every run.

### F5 — MEDIUM · uncovered-path · publish-only / no-content goal yields plan_error dead-end
`workflow-planner.ts:30-38`: concept_writer is added only if
needsTextPost|needsInfographic|needsStoryboard|needsVideo. If a GoalSpec has
`needsPublishing=true` but all four content flags false (LLM analyzer can emit needsTextPost=false;
note `removalsSchema` at `requirement-analyzer.ts:14` can't disable text, but the analyzer's initial
parse can), selectAgents returns `['publisher']` → publisher.requires content_concept unsatisfiable
→ `validatePlan` → `plan_error` (`workflow-planner.ts:93-95`). Handled as a recoverable error, but
for an autonomous driver it's a dead-end with no auto-recovery/repair. Also all-flags-false +
publishing-false → `no_agents_selected`. A machine planner needs a fallback (e.g. force
needsTextPost when publishing and no other producer).

### F6 — MEDIUM · inconsistency · content_search mis-classified in SPENDING_AGENTS (and it's dead code)
`node-cost.ts:113-115` `SPENDING_AGENTS` omits `content_search`; the comment claims "content_search
stub … = $0". But content_search is LIVE and spends: `runResearcher` records LLM usage + a $0.035
grounding surcharge (`agent-runners.ts:244-263`). Separately, `SPENDING_AGENTS` is imported/used in
**zero** other files (confirmed grep) — pure dead code. Why it matters: it's a stale spend-map. If
Atria's cost/approval logic ever consults it (natural thing to reach for when deciding which nodes
need a spend-approval), it would treat research as free. Either delete it or fix + wire it.

### F7 — MEDIUM · inconsistency · concept selection-gate is invisible to registry/UI, defaults to human
The concept pause is a hardcoded `SELECTION_GATE = new Set(['concept_writer'])`
(`workflow-executor.ts:55`), NOT registry-driven. `concept_writer.requiresApproval=false` in the
registry, and `/orchestration/agents` serves that false to the command-center (`:458`). So the UI
(and any Atria roster logic reading registry metadata) sees concept_writer as non-gating, while it
actually PARKS the run at `needs_approval` by default (conceptGate defaults true, both in the
executor `:322` and the execute route `:285`). Display-vs-behavior mismatch + a second gate the
registry doesn't describe. A machine must know to pass `conceptGate:false` (mechanism exists, but
the default and the served metadata both say the opposite).

### F8 — MEDIUM · template-drift · cloneTemplateRun copies plan verbatim, no registry re-validation
`workflow-run-repo.ts:100-122`: an instance is cloned from a frozen `template.plan` (agentId strings
copied as-is) with no check against the CURRENT registry. If an agentId is later removed/renamed
from `AGENTS`, the instance carries a node whose `getAgent` returns undefined →
`validatePlan` "unknown agent" → whole instance run fails at start
(`workflow-executor.ts:99-104`), and `getRunner` would also miss. No mapping/migration. Related but
benign: frozen `node.requiresApproval` is intentionally ignored (live registry wins at `:243`), so a
template frozen when video.requiresApproval=false now correctly halts — good, but means a frozen
plan's gate flags are dead metadata. For a system where Atria evolves the roster, dropped/renamed
agents silently break every pre-existing template.

### F9 — LOW · inconsistency · lead_collector shown as "coming soon" but is a live subsystem elsewhere
`vision-agents.ts:30-37` lists `lead_collector` as display-only `planned` (UI renders it dimmed
"sắp ra mắt", `command-center-page.tsx:111`). But lead collection is actually implemented and live
under `src/leads/*` (per project memory: cron, scoring, capture). It's just not a DAG agent. Cosmetic
today, but once Atria drives the roster the "planned/soon" flag contradicts a shipped capability —
the machine may not know it can already act on leads.

### F10 — LOW · uncovered-path · mixed deliverable (infographic + storyboard) collapses assetType
`goal-spec.ts:58-59` `assetTypeFromOutputs` priority video>storyboard(carousel)>image. A goal with
BOTH needsInfographic and needsStoryboard (no video) resolves to `carousel`, but the infographic
node still runs and `attachPostMedia(...,'image',...)`. Post.assetType and the actually-attached
media can disagree; the media gating in `MEDIA_AGENT_ASSET` then runs both. Low likelihood, but a
machine mixing deliverables gets an ambiguous post.

---

## 3. Notes / what's solid
- Node→runner dispatch is exhaustive and typed (`RunnableAgentId` union ↔ `runners` record ↔ zod
  `runnableAgentId` enum all agree). No plannable-but-crashing agentId.
- Executor reads the BEFORE-gate policy from the LIVE registry, so template/plan drift on
  `requiresApproval` is correctly handled for video/publisher (the concept selection gate is the
  exception — F7).
- Edge derivation (`produces`→`requires`) + Kahn topo-sort + input-satisfiability validation is
  clean; adding a registry agent + runner genuinely extends the system. The one gap is media
  attached as a side effect on the Post instead of as an artifact edge (F1).

## 4. Unresolved questions
- Is there an intended Atria-side GoalSpec completer that would satisfy F3 (making the clarification
  gate moot for autonomous runs), or must the gate gain a bypass?
- For autonomous video (F4): is manual video approval a deliberate cost guardrail to keep, or does
  the farm need an auto-approve-with-budget-cap path?
- F2: should fresh-goal runs create the Post at PLAN time (so `attachedPost` is non-null and
  auto-publish/media-gating engage), rather than mid-run in concept_writer?

**Status:** DONE
**Summary:** Registry/dispatch are structurally sound, but four HIGH autonomy hazards block "no
human clicks" end-to-end: carousel publisher has no media dependency edge (publish-before-media
risk), fresh-goal runs can never auto-publish, the clarification gate has no autonomous bypass, and
any video plan double-gates with no override.
**Concerns:** F1 (carousel) and F2 (fresh-goal auto-publish) are latent correctness bugs, not just
config gaps — worth fixing before Atria drives execution.
