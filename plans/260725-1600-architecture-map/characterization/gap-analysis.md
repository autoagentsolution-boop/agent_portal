# Phase 0 — Characterization Gap-Analysis (2026-07-26)

> **▶ STATUS: BE gaps WRITTEN (P0+P1). Verify green pending final run.** Shipped this session:
> - NEW `src/scripts/verify-intent-corpus.ts` (the file the corpus comment always named) — deterministic FACT/TRUE-removal green, FALSE-removal suppressed, and the "regex CANNOT" case (`no-longer-just-fb`) pinned as a KNOWN limit (flip when Phase 2 lands the model-authoritative fix).
> - NEW `src/orchestration/verify-storyboard-node.ts` — carousel branch, anchor→edit chaining, F1 Pro per-frame, frame-skip, all-fail-throws.
> - EXTENDED `verify-executor.ts` — media-gating skip (carousel post never pays for video), schedule-gate scheduledAt-preservation, abort-mid-run, publisher fail-loud.
> - EXTENDED `verify-master.ts` — near-verb 24-char window boundary (both sides), parseAutoPublish deterministic (en+vn).
> - EXTENDED `verify-image-quality-routing.ts` + `agent-runners.ts` now EXPORTS `KEYFRAME_TEXT_RE` so the F1 pin imports the REAL regex (no drift-prone copy).
> - DEFERRED to a later sub-phase (lower priority, per gap-analysis): P4 email threading/opt-out, P5 nurture-brain verbatim seed, P6 content_search cost, P8 dispatcher completeness + greeting kill-switch, and all analyzer P2/P3 (email subject/purpose, language/length slots, needsResearch narrowing). FE agent-browser = separate sub-phase.
>
> A "KNOWN limit" assertion is characterization, not a bug fix: the regex mis-drops facebook on "I no longer want just Facebook…". Pinned as CURRENT behavior so a Phase-3 split can't change it silently.

**Method:** 3 read-only gap-analyst agents mapped the 91 existing `verify-*.ts` against the 5 Phase-3 god-files. Only behaviors NOT already pinned are listed (DRY — extend existing verifies, don't duplicate). Every gap is **deterministic** (stub LLM/publish/connection readers already exist) unless noted.

## Coverage verdict
Strong. Most runner/executor/analyzer behavior is already pinned. Real gaps are focused. FE is the only zero-coverage region.

## Backend gaps — prioritized (write these; Phase 3 touches these files first)

### agent-runners.ts (1420L → split by family)
- **P1 storyboard runner** — completely uncharacterized. Assert `getRunner('storyboard')` w/ stub imageFn/llmJsonFn: (a) carousel post → `attachPostMedia(...,'carousel',csv)`, video post → no carousel attach; (b) first ok frame = anchor, later frames `mode:'edit',referenceImagePath:anchor`; (c) frame matching `KEYFRAME_TEXT_RE`→`quality:'pro'`; (d) one thrown frame skipped, all-fail→throw. → **new `verify-storyboard-node.ts`**. Deterministic (needs throwaway-tenant DB post for carousel branch).
- **P2 publisher fail-LOUD (H1)** — `!picked || status∉{posted,partial}` → throw; missing postId → throw. Only success path pinned today. → extend `verify-executor.ts`.
- **P3 F21 ffmpeg preflight ORDERING** — `verify-video-script.ts` always injects stitchFn → preflight branch never runs. Assert `getRunner('video')` w/ stitchFn UNSET + bogus FFMPEG_PATH → throws BEFORE any imageFn call (spy zero calls); stitchFn SET → skipped. → extend `verify-ffmpeg-preflight.ts`.
- **P4 email_agent gmail threading + runner-level opt-out** — threading headers (threadId/In-Reply-To/References) from nurtureThread; runner's own isEmailSuppressed filter + all-suppressed→throw. → extend `verify-nurture-email-from-chat.ts`.
- **P5 email_writer nurture-brain verbatim seed** — `nurtureReplyBody` set → body===seed verbatim, groundedOn:'nurture_brain', llmJsonFn NEVER called. → extend `verify-email-node.ts`.
- **P6 content_search runner cost + record-once** — GROUNDING_SURCHARGE in cost, record-once-on-real-call. verify-researcher tests runResearch in isolation, never the runner. → extend `verify-researcher.ts`.
- **P7 shared-resolver drift** — (a) `resolveRunLanguage` no-post legacy → DEFAULT_LANGUAGE not 'en'; (b) `verify-image-quality-routing.ts` re-declares `KEYFRAME_TEXT_RE` → make it IMPORT the real regex so F1 pin follows the source. → extend verify-image-quality-routing.
- **P8 dispatcher completeness** — every RunnableAgentId → defined getRunner (loop registry); greeting_agent kill-switch pause throw. → extend verify-executor / verify-greeting-node.

### workflow-executor.ts (536L → gate-runner extraction)
- **P0 schedule-gate scheduledAt-preservation** — seed attachedPost w/ FUTURE scheduledAt, approveNodeId=publisher → node completed, NOT published, scheduledAt byte-identical (guards the `new Date()` clobber bug). → extend `verify-scheduler-node.ts`.
- **P0 media-gating skip** — carousel/image attachedPost + plan w/ video node → video node `skipped`, videoFn never called (guards unapproved Veo spend). → extend `verify-executor.ts`.
- **P1 publish-boundary connection re-gate** — connectionReaderFn:[]+real publishFn stub → parks `needs_connection`. → extend verify-executor.
- **P1 credit reconcile finally + failed-guard** — drive runWorkflow to (a) park → 1 debit, (b) node failure → ZERO debit. verify-credit-wallet is repo-level only, not the executor finally-block. → extend `verify-credit-wallet.ts` to call runWorkflow.
- **P1 abort mid-run** — set run aborted between nodes → returns {status:'aborted'}, next runner never invoked. → extend verify-executor.
- **P2 campaign_strategist selection-gate park through executor** (shares `gate:'selection'` w/ concept — untested via runWorkflow); **P2 auto-publish waiver + hasCostGate suppression**; **P3 approveOrThrow loud-fail + timingSuggestion attach**.

### deterministic-analyzer.ts (360L regex → split by concern)
- **P0 create missing `verify-intent-corpus.ts`** — codebase NAMES it (intent-corpus.ts comment) but it doesn't exist; corpus runs only in verify-master's LIVE gemini smoke. Run `analyzeDeterministic`+`parseRemovals` over TRUE_REMOVAL_CASES + noRemoval half of FALSE_REMOVAL_CASES deterministically. Single biggest fragility for removals-by-concern split.
- **P1 near-verb 24-char window boundary** — cases straddling the slice (verb ~20 chars→fires, ~30 chars→doesn't). → extend verify-master.
- **P1 parseAutoPublish deterministic** — `analyzeDeterministic('đăng luôn khỏi duyệt').autoPublish===true` at analyzer, not live smoke. → extend verify-master.
- **P2 parseEmailIntent subject/purpose/multi-recipient dedup**; **P2 parseLanguage/parseLength slots**; **P3 needsResearch narrowing** ("go-to-market"→false).

## Frontend gaps (App.tsx 458L, client.ts 744L) — zero automated coverage today

**KEY CORRECTION:** SSE/markRunning/INPUT→TEXTAREA are NOT in App.tsx (they live in post-workflow-view.tsx/saved-flow-detail.tsx + hooks/events-bus.ts, and OrchestratePanel). App's hook-extraction risk = useCallback-STABILITY invariants + cross-domain refresh fan-out, narrower than the plan assumed.

- **4 P0 agent-browser journeys** (need full stack: BE:7100 + web:5173 + Chromium CDP:9333 + superadmin cookie):
  1. `cc-chat-send-and-reentry` — plan card renders ONCE, re-entry re-hydrates transcript, NO duplicate assistant reply, INPUT→TEXTAREA (Enter send/Shift+Enter newline).
  2. `cc-flow-execute-approve` — execute→node running (optimistic markRunning)→approve gate→SSE status flip; executeRun 402→credits toast.
  3. `campaign-postboard-merge` — open A→B→A, A's cards intact (mergePosts merge-not-replace), no infinite "Posts•Loading…", create-post modal opens once (clearPendingCreate stable).
  4. `cc-voice-launch-close` — voice launch→mic listening→close chat→voice UI idle, mic released (voicePanelRef.stopVoice).
- **P1 client.ts wrapper contract** (survives Phase 2.2 DTO fold — assert RUNTIME not types): shared `request<T,M>` — 401→throws UnauthorizedError, 204→ok/undefined, network→{ok:false,network_error}, success unwraps .data+.meta, credentials:'include' cookie-auth. Journeys: postcard-lifecycle, nurture-inbox-approve-reject, leads-table (the one place the `meta` generic is exercised).
- **P2 thin render guards**: connections-oauth-render, superadmin-url-gate, usage-impact-render.
- **NOT browser-observable** (need StrictMode-wrapped Vitest/RTL companions instead): StrictMode double-invoke guards (autoStarted/attachConsumed/mountedRef refs), useCallback referential stability (mergePosts/handleVoiceChange/clearPendingCreate), events-bus ref-counting, bootstrap-effect fan-out request-count.

## Execution order (user-approved 2026-07-26)
**BE gaps first** (P0+P1, deterministic, extend existing verifies + 2 new files), run verify green, commit, 3-agent review. FE agent-browser = separate sub-phase when browser stack is set up.

## Raw agent reports: this file IS the synthesis; the 3 raw reports were consumed inline (not saved separately — token economy).
