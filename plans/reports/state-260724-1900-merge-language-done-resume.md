# Session handoff — 2026-07-24 (evening) · Atria merge + language fix DONE

Cold-start doc. Branch `pivot/video-content-farm`. **NOT committed yet** (7 source files changed, uncommitted).

## What shipped this session (code changed, verify green, live-verified — NOT committed)

Observed test resumed at 6b → ran the full 11-script suite → found a cluster → fixed the top of it.
Report: `plans/reports/test-260724-1636-script6b-and-f15-mergeplan.md`. Plan:
`plans/260724-1636-atria-merge-and-language-fix/`.

### Fixes (all in `MKTAgent/src`, uncommitted)
1. **F15 — tool merge.** `propose_task` absorbed INTO `propose_workflow` (one tool now; marketing branch
   byte-identical, utility branch gained `capability`/`source_text`/`email_to`). Planner
   `workflow-planner.ts` `targetsFromGoal` UNIONs `taskTargets` + `email_result` (was a short-circuit).
   Task-email recipient = an @ address in the request NOT in `source_text` (language-agnostic; lead-by-name
   wins — F10). **Live-verified KO**: summarize+email → `security → summarize → email_writer → email_agent`.
2. **Language LLM-authoritative.** `detect-language.ts` `contentLanguageFor` = prior → declared(model) →
   detection → en. VN detection proportional + LOWERCASE-only (a Capitalized brand "Nắng Sớm" no longer
   flips). `SCRIPT_DETECTABLE` reject retired. **Live-verified**: Spanish + "Nắng Sớm" → `es`.
3. **F18 — text-emitted tool calls** (`atria-brain.ts`): detect `tool_code`/`print(default_api…)` → discard
   + nudged re-prompt; recovered real call is dispatched and the loop continues (H1 fix — no lost
   schedule/execute).
4. **F17 — save_memory** description/prompt made imperative on explicit "remember".

Files: atria-tools.ts, atria-brain.ts, detect-language.ts, workflow-planner.ts, atria-brain-prompt.ts
(+ verify-master.ts, verify-summarize-node.ts test updates). tsc clean; **72/72 verify (22 unit + 50 db)
GREEN**. Code-reviewer ran — its H1 (fixed) + H2 (addressed via language-agnostic recipient + resolvedLead)
+ M1 (fixed: lowercase-only VN) handled; M2 (short VN false-negative) + RISK-1 (memory-bleed guard retired,
intended) accepted as bounded (detection is now only a fallback).

## NEXT
1. **COMMIT** this batch (not done). Suggested: `fix(atria): merge propose_task into propose_workflow, LLM-authoritative language, F18 tool_code robustness`.
2. **User's open ask:** "why do intent and goal still use regex?" — the `requirementAnalyzer` (product/
   platforms/outputs slots) + `parseEmailIntent`/`parseRemovals` are still regex. Direction the user wants:
   the model declares the full goal, regex becomes fallback only. This session moved language + email-
   recipient + kind onto model-declared; the remaining analyzer migration is a LARGER separate phase — SCOPE
   IT before doing (high regression surface: the whole marketing path builds on the analyzer).
3. **Remaining observed-test findings (deferred, separate tracks):**
   - **F1** VN on-frame text corrupts ("Nắng Sớm" → "Nắng Sóm" on video keyframe) — `nano-banana.ts:21`
     hardcodes `gemini-2.5-flash-image`, no Pro option. Hits infographic + video keyframes.
   - **F21** ffmpeg exits `0xC0000142` (STATUS_DLL_INIT_FAILED) when the backend spawns it on Windows →
     video render spends ~$1 on keyframes+Veo then fails to stitch, no deliverable. Infra + a pre-flight
     ffmpeg check owed.
4. **Observed-test scripts run this session:** 6b (F15+F16), 7 ✅, 8 (F17), 9 (F18), 10 (scope-miss + lang),
   11 (F19 mem-bleed scope + F1 confirmed + F21). F19 = recalling an established brand drags its old
   campaign scope/platforms over a single-asset request (memory-bleed into scope) — noted, not yet fixed.

## Env (LEFT RUNNING)
pg :5433 (`mktagent-postgres-1`) · BE :7100 (`npx tsx src/server.ts`, background task `b2gj1wr98`, **NO
watch — restart after edits**; ⚠ this session had 11 zombie BE instances fighting over :7100 and serving
STALE code — always `Get-CimInstance … server.ts | Stop-Process` ALL of them before a clean start) · web
:5173 (vite `--strictPort`) · Chromium CDP :9333 · logged in as user tenant
`6455c2bd-67cc-48cb-ab77-5ead25747d02` (superadmin, ~1,950 credits) via `mkt_session` cookie
(recipe in `project_observed_live_test_260722`). `sendGmailAs` has NO dry-run gate; the harness blocks
outward send/approve clicks → the USER approves sends. `ENABLE_LIVE_SOCIAL_PUBLISH=false`.

## Cleanup owed (when user says)
`MKTAgent/output/videos/*.mp4` (3 orphan Veo clips ~$0.90) + `output/images/*.png` (3 keyframes) from the
failed render. Live-account test leftovers: lead `a3ad8bb8…`, nurture thread `65d1e23f…`, intake token,
plus today's throwaway chats.
