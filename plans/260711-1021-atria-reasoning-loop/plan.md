# Atria Reasoning Loop — intent-router redesign (P1a)

**Branch:** `pivot/video-content-farm` · **Started:** 2026-07-11

## Goal
Replace the regex `classifyIntent` + immediate marketing extraction with a real **LLM-driven agentic reasoning loop** ("Atria's brain"). Atria is a general assistant FIRST: it greets + empathizes, reasons/deep-dives with the user, calls tools (web search, workspace data, memory) mid-conversation to inform its next reply, and only orchestrates agent nodes when a task actually needs a capability. No hardcoded intent frame, no template — behavior lives in the system prompt + tool loop, like a Claude-Code subagent.

## User decisions (2026-07-11)
- **Confirmation cadence:** Atria reasons + searches FREELY (no click to look things up). It halts for explicit confirmation ONLY at critical/external steps — anything touching production or the user's real platforms. Maps onto existing approval gates (`publisher`, `email_agent`, `video` cost gate = `requiresApproval:true`).
- **Flow card ALWAYS visible during the conversation:** as Atria assembles a plan, a DAG/flow card renders so the user sees which agents will run before approving. Reuses the existing `planned`-run plan card.
- **v1 scope:** full brain + all 4 tools at once. Marketing planner stays intact behind `propose_workflow` — no regression.

## Architecture
`POST /orchestration/runs` → **atria-brain** (function-calling loop) FIRST.
- Loop: Gemini + `tools:[{functionDeclarations}]`. Brain thinks → optionally calls a tool → sees result → thinks again → emits either a conversational reply (DEFAULT) or a workflow proposal.
- Tools (each wraps existing code, no new engines):
  | Tool | Wraps |
  |---|---|
  | `web_search(query)` | `groundedSearch` (Gemini google_search grounding) |
  | `get_workspace_data(period)` | `answerDataQuery` (real Impact numbers) |
  | `recall_memory(topic)` / `save_memory(kind,content)` | `user-memory` repo |
  | `propose_workflow(goal_description)` | `requirementAnalyzer.analyze` → `masterAgent.planFromGoal` |
- Brain turn result: `{kind:'reply', text, searched?}` → reply-only run (`recordAnswerTurn`); or `{kind:'proposal', text, goal, outcome}` → `planned` run + flow card + existing approve gate.
- `classifyIntent` retires (kept only if a cheap fast-path proves worth it).

## Phases
- [x] **P1 — Backend core** (`atria-tools.ts`, `atria-brain-prompt.ts`, `atria-brain.ts`): tool declarations + dispatch, function-calling loop, system prompt (empathetic, greet, confirm-at-critical, flow-card-aware). Compile-clean (tsc 0 errors).
- [x] **P2 — Router integration** (`orchestration-router.ts` POST /runs + `getChatHistory` export in `orchestration-chat.ts`): brain called first; reply→`answered` run, proposal→`planned`/`awaiting_clarification` run (fresh via persistOutcome, in-place via applyOutcomeToRun); `classifyIntent` retired (now dead code in `intent-router.ts` — safe to delete). `appendSources` footnote for grounded replies.
- [x] **VERIFIED (direct-loop smoke, real Gemini 2026-07-11):** greeting→REPLY; general Q→REPLY (answers directly); "làm video…đăng Facebook"→PROPOSAL `concept_writer→storyboard→video→publisher` (flow card DAG); data-query→REPLY (fired get_workspace_data tool). Routing inversion proven. Prompt tuned so decisive capability requests propose immediately (don't ask permission to propose).
- [x] **P4 — e2e via HTTP (real owner `auto.agent.solution`, 2026-07-11):** greeting→answered (converse); data-query→answered with **REAL numbers** (13 posts, ~3,900 reach, 1 lead, $4.89 via get_workspace_data tool); **email birthday send** "Create a birthday greeting email in English and send to nghiepit.lamthuan@gmail.com" → brain proposed `email_writer→email_agent` (planned, honest "nothing sent until you approve", NO marketing framing) → `/execute` drafted + parked at send gate (`needs_approval`, email_agent awaiting_approval) → `/approve-node/n2` → **REAL Gmail send, msgId `19f4f66de70fb6d8`, status sent**. Confirmation gate held; out-of-the-box assistant thesis PROVEN.
- [~] **P3 — Flow card during conversation**: data path proven (proposal → `planned` run WITH nodes in DTO → existing plan card renders). Browser-visual confirm still pending (low risk — reuses existing card). awaiting_clarification cardless — acceptable v1.
- [x] **Committed + pushed:** `0b7724a` (reasoning brain), `c4d738d` (P0/P1 hardening).
- [x] **Reviews (4 agents) + fixes:** QA/QC, Senior, Architecture, Cost → synthesis in `plans/reports/`. P0/P1 all fixed + verified live: multi-turn slot accumulation (product/platforms/audience survive 3 turns), 45s turn budget + MAX_ROUNDS 5→3, credit-leak fixed (web_search → `research`-surface ledger row), graceful non-marketing degradation, mid-setup flow-card kept, `.catch` on ledger, observability logs.
- [ ] **Follow-ups:** delete dead `intent-router.ts`; reconcile old `verify-master`/intent verify scripts. Infra note: DB is a docker-compose Postgres on :5433 (`docker compose up -d postgres`), Docker Desktop must be running.
- [→] **P1b started:** node-decoupling design + phasing in `plans/260711-1140-p1b-node-decoupling/plan.md` (needs greenlight before core planner changes).

## Dead code to remove
- `src/orchestration/master/intent-router.ts` (`classifyIntent`) — no production references after P2.

## Key files
- New: `src/orchestration/atria/atria-brain.ts`, `atria-tools.ts`, `src/orchestration/prompts/atria-brain-prompt.ts`
- Modify: `src/api/orchestration-router.ts` (POST /runs), `src/api/orchestration-chat.ts` (turn persistence if needed)
- Reuse (no change): `grounded-search.ts`, `report-answer.ts`, `user-memory.ts`, `master-agent.ts`, `requirement-analyzer.ts`

## Risks
- Gemini function-calling loop can runaway → hard cap tool rounds (≤5) + timeout per call; degrade to a plain conversational reply on any loop failure (never break the turn).
- `google_search` builtin can't mix with `functionDeclarations` in one call → web_search is a FUNCTION; grounding happens in a nested `groundedSearch` call. Clean separation.
- Marketing analyzer still fires inside `propose_workflow` — fine, it only runs when the brain has decided the task needs a capability.
- Confirm-at-critical relies on existing gates staying intact → do NOT touch executor gate logic.
