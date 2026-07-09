# Adversarial Review — demo-readiness P1/P2/P3 (db0e65f..HEAD)

Reviewer pass, read-only. Branch `pivot/video-content-farm`, 5 commits (d6dcf30, 29826f7, 25cb9b8, 2f55683, b99630e).

Scope: `approvalMode` DTO exposure, per-post grant UI, SSE node light-up, read-aloud/Gemini-TTS seam, workspace badge.

Status: **DONE_WITH_CONCERNS** — no hard P0, but two P1 correctness dead-ends and several P2 resource/UX issues. Core is real and mostly sound.

---

## P1 — should fix before demo

### P1-1. Atria-granted run that FAILS or parks at needs_connection is a UI dead-end
`web/src/components/post-workflow-view.tsx:207-213`, `src/orchestration/autonomy/autonomy-runner.ts:57-61`, `src/db/repos/workflow-run-repo.ts:505-517`

Logic:
- `isAtriaGranted = run.approvalMode === 'atria'` gates OUT `canExecute` for **every** state, including `failed` and `needs_connection` (`canExecute = !isAtriaGranted && (planned|failed|needs_connection…)`).
- `preparing` only covers `planned`/`running`; `canGrant` is false once granted.
- The autonomy runner sets `status='failed'` on any thrown error during prep (`setRunStatus(run.id,'failed')`), leaving `approvalMode='atria'`.
- `claimNextGrantedRun` only re-claims `status:'planned'` — a `failed` (or `needs_connection`) atria run is **never re-picked by the cron**.

Failure scenario: during the demo the granted run hits a Gemini/tool error → `failed`. The post view now shows only the failed `statusHint` with **no Execute button, no grant button, no preparing spinner, and no cron retry**. The post is bricked from the UI; user must go elsewhere (or DB) to recover. Same trap for a granted run parked at `needs_connection` (the ConnectionRequired block relies on `requiredActions` which only ride the `/execute` response, absent on a reloaded run).

Fix (describe): when `isAtriaGranted && (status==='failed' || status==='needs_connection')`, either (a) re-enable a manual recovery button (Execute / re-run) by not suppressing it for terminal-ish states, or (b) add an "un-grant / take back" action that flips `approvalMode` back to `human`, or (c) have the cron also re-claim `failed` atria runs with a bounded retry count. Option (a)+(b) is safest for a demo.

### P1-2. Grant depends on `ENABLE_AUTONOMY_CRON`; if off, "đang chuẩn bị" spins forever with Execute suppressed
`web/src/components/post-workflow-view.tsx:82-87,207-213`, `src/server.ts:165`, `src/orchestration/autonomy/autonomy-cron.ts`

`preparing` polls every 8s waiting for the cron to advance the run. The cron only mounts when `env.ENABLE_AUTONOMY_CRON` is truthy. It is currently set in `.env`, so this is latent — **but** `env.ENABLE_AUTONOMY_CRON` uses `z.coerce.boolean()`, which coerces `"0"`/`"false"` to `true` (only empty string is false). So the *intended* off-switch (`=0`) does not actually disable it, and conversely any deploy that drops the var yields a granted post that shows an infinite spinner with the manual Execute button removed (`canExecute` false while `isAtriaGranted`). No user-visible timeout or fallback.

Fix (describe): (1) use an explicit `z.enum(['0','1'])`/`=== '1'` parse for the flag instead of `coerce.boolean()`; (2) add a client-side watchdog — after N poll cycles with no state change, surface "autonomy not running — Execute manually?" and re-expose Execute.

---

## P2 — fix soon

### P2-1. "⚡ Chuẩn bị" offered on non-campaign posts → guaranteed 409
`web/src/components/post-workflow-view.tsx:212`, `src/api/posts-router.ts:446`

`canGrant = !isAtriaGranted && run.status==='planned' && Boolean(runPostId)` — it does NOT check that the post belongs to a campaign. The backend hard-requires `post.campaignId` (`409 not_a_campaign_post`). A standalone board/flow post (campaignId null) shows the button; clicking it always fails with an error toast "Chuẩn bị: not_a_campaign_post". Visible dead action during a demo.

Fix: the run DTO has no campaign flag exposed to the client for this. Either expose `createdCampaignId` presence (already an optional DTO field) and gate `canGrant` on it, or add a `grantable` boolean to the run DTO computed server-side.

### P2-2. Third standing SSE connection — HTTP/1.1 6-per-origin exhaustion risk
`web/src/hooks/use-agent-activity.ts:24`, plus existing `use-run-events.ts` / `use-workspace-events.ts`, server `src/api/events-router.ts` (no per-owner cap)

`useAgentActivity(agents.length>0)` opens a **new, always-on** EventSource to `/events` on the Command Center (the landing). Combined with `useWorkspaceEvents` (drawer) and `useRunEvents` (post view), a single tab can hold 3 long-lived SSE streams. Browsers cap ~6 concurrent HTTP/1.1 connections per origin (Vite dev is HTTP/1.1). Two tabs → 6 SSE → all subsequent `fetch()` calls hang until a stream is freed. The server has no per-owner connection cap either (`subscribe` Set grows one entry per connection).

Fix: multiplex — a single shared EventSource context/provider that fans `node.status` / `post.status` to all three consumers, instead of one connection per hook. At minimum, document the HTTP/2 requirement for production so streams multiplex over one socket.

### P2-3. `/voice/tts` has no rate limit — cost amplification
`src/api/voice-router.ts:29-52`

Text is bounded (4000 chars, global 1mb json cap) and owner-scoped, and repeats are free via the filesystem hash cache — good. But there is no per-owner rate limit: an authenticated client can loop distinct texts, each costing a real Gemini synthesis + `$0.02` recorded. Low risk for an internal tool, but a runaway `ReadAloudButton` (see P2-4) or a script could rack up spend.

Fix: a lightweight per-owner token bucket on `/voice/tts` (e.g. N synth/min), or debounce on the client.

### P2-4. Read-aloud double-click race → overlapping audio + double cost
`web/src/components/read-aloud-button.tsx:40-58`

`play()` guards with `if (status === 'loading') return;` but `status` is captured from the render closure. Two rapid clicks on the same button before React re-renders both observe `status==='idle'` → two `fetchTts` calls, two `Audio` objects. `currentAudio` only tracks the last, so the first audio can play un-stoppable to the end, and both synth requests bill (if uncached). The module-singleton only guarantees single playback *across different* buttons, not against a self double-click.

Fix: use a `ref` (e.g. `busyRef`) as the guard instead of state, or disable the button while `status !== 'idle'`.

### P2-5. Blob URL leak on unmount-during-fetch
`web/src/components/read-aloud-button.tsx:32-33,46-49`

If the component unmounts while `await fetchTts(text)` is in flight, the cleanup effect has already run (revoked old `urlRef`, nulled `currentAudio`). The resolved `URL.createObjectURL` result is then assigned to `urlRef.current` on an unmounted component and never revoked → blob leak (one per orphaned narration). Also `new Audio` on an unmounted node. Bubbles/reports that scroll away mid-load are the trigger.

Fix: track a mounted flag / AbortController; if unmounted after resolve, `URL.revokeObjectURL(url)` immediately and don't set state.

---

## Nits

- `read-aloud-button.tsx:24` — on `!res.ok` the catch silently sets `idle`; user clicks and nothing happens, no `notify`. A 401 here does NOT trigger the app's global `UnauthorizedError` re-auth path (raw fetch bypasses `client.request`). Consider surfacing an error toast.
- `voice-router.ts:49` — `Cache-Control: private, max-age=3600` on a POST response is inert (browsers don't cache POST). Effective caching is server-side file cache only; header is misleading. Harmless.
- `post-workflow-view.tsx:83-87` — the 8s poll `setRun(new object)` re-renders every tick, and once status flips to `running` it runs *alongside* `useRunEvents` SSE (both update the same run). Redundant, minor churn. Consider stopping the poll once SSE is live (`status==='running'`).
- `voice-router.ts:33` — `voice` param length is unbounded (only `text` is clamped). An oversized `voiceName` just fails at Gemini → 502; harmless but worth a small bound for symmetry.
- `voice-router.ts:14` — `TTS_COST_USD = 0.02` is a hand-copied constant that must stay "in lock-step" with `node-cost.ts ttsCost()`. Drift risk; import the shared estimator instead of duplicating.

---

## Positive observations

- Subscriber accounting is correct: each EventSource gets its own `subscribe`/unsubscribe; `bus.ts` deletes empty owner sets — the extra connection does not leak server-side.
- TTS cost is charged only on a real (non-cached) synthesis; owner-scoped via `req.userId!`; text clamped at a sentence boundary; body bounded by the global 1mb json cap. Solid boundary hygiene.
- `approvalMode` is added as an **optional** DTO field and the mapper defaults unknown → `'human'`: backward-compatible, no break to existing run consumers.
- `useAgentActivity` clears the active set on `onerror` and on disable, so a dropped stream can't leave a node stuck lit; the `running === prev.has(id)` short-circuit avoids needless re-renders.
- Grant flow is genuinely two-step server-side (token issue then verify); `grantAutonomy` is guarded by an atomic `updateMany` on grantable states — no retro-grant of a running/finished run, no double-publish.
- Read-aloud unmount cleanup correctly nulls the module singleton only when this button owns it.

---

## Verdict
No landing-blocker P0. **Two P1 correctness dead-ends** (granted-run failure recovery; cron-dependency spinner) are the real demo risks — both are "granted post gets stuck with no button." Resource issues (3rd SSE, TTS rate limit, double-click race) are P2. Recommend fixing P1-1 and P1-2 before the live demo.
