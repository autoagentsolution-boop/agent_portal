# Atria fix batch — tool merge (B) + prose/plan backstops + LLM-authoritative language

Source: observed test 2026-07-24 (`plans/reports/test-260724-1636-script6b-and-f15-mergeplan.md`).
User decision: fix scope = **B (merge propose_task + propose_workflow) + the prose/plan family**, and make
**language LLM-authoritative** (stop letting regex/detection override the model's read of the message).
Branch `pivot/video-content-farm`. Do all tests green, then this.

## Phases

- [x] **Phase 01 — LLM-authoritative content language** (`phase-01-language-seam.md`) — DONE, verify-master green, tsc clean. `contentLanguageFor` = prior → declared(LLM) → detection → en; proportional VN detection; script-10 regression pinned. Behavioral changes: a detectable refine no longer overrides an established flow (first-chat decides); a model-declared script language is now TRUSTED (memory-bleed refusal retired). Live re-test pending BE restart.
  Reorder `contentLanguageFor` so the model's per-message declaration is authoritative for the
  Latin-ambiguous case (fixes script-10: a VN brand name in a Spanish message flipped the reply to VN).
  Keep non-Latin SCRIPT detection as ground truth; demote the VN diacritic/word HEURISTIC below the
  declaration; resolve the memory-bleed + bare-confirm edge cases. Rework verify-master 279-302 + add a
  script-10 regression test + pin in a verify (per feedback: "a rule in memory governs nothing").
  SELF-CONTAINED — ship first, independent of the merge.

- [x] **Phase 02 — Merge propose_task INTO propose_workflow (one tool)** — DONE. Chose absorption over a
  ground-up rename to keep the tuned propose_workflow prompt + marketing path byte-identical (lower
  regression risk, same "one tool" outcome). `propose_workflow` gained optional `capability` / `source_text`
  / `email_to`; `propose_task` case + schema removed; brain prompt folded. Planner `targetsFromGoal` now
  UNIONs `taskTargets` with `email_result` (was a short-circuit). Task-email recipient is language-agnostic
  (an @ address in the request but NOT in source_text; lead-by-name still wins — F10). **Live-verified**:
  KO "summarize + email" → security → summarize → email_writer → email_agent. 72/72 verify green.

- [x] **Phase 03 — F18 tool_code strip + F17 memory + F10/H1 fixes** — DONE. F18: text-emitted tool calls
  (`tool_code`/`print(default_api…)`) are detected, discarded, and re-prompted (nudged); a recovered real
  call is dispatched and the loop continues (H1 — no lost schedule/execute/follow-up). F17: `save_memory`
  description + prompt made imperative for explicit "remember" requests. NOTE: the merge itself resolves
  the F15b email prose/plan divergence (the plan now includes the email the prose promised).

## Out of scope (separate tracks, logged)
- F1 VN on-frame text (nano-banana no-Pro-option) — media-quality track.
- F21 ffmpeg 0xC0000142 on Windows — infra; + a pre-flight ffmpeg check before spending on keyframes/Veo.

## Sequencing
01 → run verify → 02 (the big one; tester + code-reviewer per workflow) → 03 → full observed re-test of
6b + 9 + 10 (the three that failed) → green → done.
