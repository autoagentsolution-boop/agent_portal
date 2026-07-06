# Next-session state — 2026-07-06

Branch `pivot/video-content-farm`. Container rebuilt this session (18 migrations, no pending).
Working tree has UNCOMMITTED changes (see "Shipped, not committed"). verify-api green.

## Shipped this session (NOT committed yet)
1. **#5 — per-node runtime + token counts.** The DAG node row now shows, after a node
   completes, its total runtime (`⏱ mm:ss` from server started/finished timestamps) and
   input/output tokens (`↑in ↓out`). Backend already persisted all of it (`wf_node_run`
   .prompt_tokens/.output_tokens/.started_at/.finished_at); the gap was purely the DTO not
   exposing 4 fields + the UI dropping everything on completion.
   - `src/api/schemas.ts` — workflowNodeDto + promptTokens/outputTokens/startedAt/finishedAt
   - `src/api/orchestration-mappers.ts` — map the 4 fields (ISO strings for the dates)
   - regenerated `openapi.json` + `web/src/api/schema.d.ts`
   - `web/src/components/run-dag-view.tsx` — `NodeStats` (duration + tokens, completed nodes
     only, so it doesn't fight `.dag-err`'s `margin-left:auto` on failed rows) + shared
     `fmtDuration`/`fmtTokens`
   - `web/src/styles.css` — `.dag-stats/.dag-stat-*`
   - DB-validated live: storyboard 68s / 822↑ 852↓, publisher 15.9s, concept 10.8s, etc.
2. **verify-api poll windows** widened to real media-gen latency (a single storyboard node
   runs ~68s; the old 20s/60s polls timed out before the DAG reached the publisher gate and
   the checks failed with blank `{}` details — NOT a product bug). Now 150s / 180s / 60s and
   they break on `needs_connection` too for clear diagnosis. Full suite PASS.

**web note:** frontend is served by vite dev (`:5173`), NOT the container — the container is
API-only. To see the #5 change, have `npm run dev` running in `web/` (HMR picks it up).

## Full-test results (scenarios 1–4)
- **#1 Indonesian, rich campaign → PASS end-to-end.** assistantMessage fluent Indonesian,
  `goal.slots.language:"id"` correctly extracted despite Latin script (this was the real
  risk — Indonesian can't be told from English by codepoint, so it rides entirely on the
  analyzer LLM; it held), accountType=company, platforms=facebook, plan correct.
- **#3 asset-type per platform → PASS** (verify-per-platform-publish, verify-postability,
  verify-post-platform-inherit all green).
- **#4 concept gate + reference image → PASS** (verify-concept-gate green).
- **#2 setup questions → LANGUAGE BUG, see below.**

## ⚠ FRICTION to tune tomorrow (user asked to document, not fix)

### F1 — clarification questions are NOT localized (mixed VN/EN)  [the real one]
Vague Indonesian message ("tolong bantu saya dengan pemasaran…") returns 5 questions in a
mish-mash of languages, none Indonesian:
- productDetails → **Vietnamese** (hardcoded `clarification-engine.ts:80`)
- accountType   → **Vietnamese** (hardcoded `clarification-engine.ts:133`)
- platforms / targetAudience / angle → **English** (`:119/:142/:145`)

Root cause: the `assistantMessage` rides the language-mirroring conversation-author, but the
**question strings are static literals** — two got authored in Vietnamese during the
VN-focused product-knowledge session and never localized. Same gap on the `+ New Post` path
(`goal-to-brief.ts` questions are all English literals).
Fix options for tomorrow: (a) run question strings through the author/translate to the
detected message language, or (b) keep them English-only as the neutral default. Either is
fine — mixed VN/EN is the only unacceptable state. Recommend (a).

### F2 — vague path asks 5 REQUIRED questions (too strict)
All 5 clarification slots came back `required:true`. That's a lot of turns before the user
can move. Suggested tuning (user's own idea in the brief):
- demote some slots to **optional** (angle, targetAudience are good candidates — the campaign
  or a sane default can fill them),
- add a short **hint line before the post/brief** telling the user which fields are optional
  and that they can refine later, so they aren't forced through every turn up front.
Keep required: productDetails (thin-product gate) + platforms (publish target) + accountType
(brand voice). Everything else → optional + hint.

## Needs manual browser confirmation (couldn't be done at API level)
- #5 timer/token actually render in the DAG UI (drive a run in Active Flows, watch a node go
  running → completed, confirm `⏱`/`↑↓` appear and persist across reload).
- #2 the "3 create paths" (New Chat / + New Post for image / video / carousel) as UI flows.
- #4 uploading a reference image file / the user's own image through the concept-gate UI
  (multipart upload path — only the logic, not the file picker, is covered by verify).

## Verify status
verify-api PASS (container). Pure/DB green: verify-concept-gate, verify-per-platform-publish,
verify-postability, verify-post-platform-inherit. typecheck + web build clean.
