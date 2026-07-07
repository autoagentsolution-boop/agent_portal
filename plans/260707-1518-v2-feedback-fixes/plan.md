# V2 Feedback Fixes — 2026-07-07

Four post-test feedback items. Root causes verified against current tree (branch `pivot/video-content-farm`).

## STATUS: all 4 phases implemented + verified 2026-07-07. tsc green (backend+web). Verifies green: publish-timing, executor, concept-gate, credits, llm-usage, refine-overrides, leads-comments/expiry/post-deleted, storyboard-video-dep, flow-cost-rollup, library. Pre-existing unrelated red: verify-post-from-agent (assetType clarification gating, fails on clean HEAD too). NOT committed.

## Phase 01 — Scheduler publish bypass (SEVERE) · [DONE]
**Bug:** executor's publisher node auto-publishes INLINE via `publishPostNow` → `claimForPublishOwned` (no `scheduledAt` gate). A future-scheduled post publishes the instant the flow reaches the publisher. Aggravated by `approveReview(id, owner, new Date())` at `workflow-executor.ts:190,302` clobbering the user's `scheduledAt` to now.
**Fix (backend):**
- Preserve schedule: approveReview calls in executor pass `attachedPost.scheduledAt ?? new Date()` (not raw `new Date()`).
- At publisher node: if `attachedPost.scheduledAt` is future → force `requiresApproval=true` (never auto-publish inline), and on approval PARK the post `ready` (schedule preserved) + mark node completed → cron publishes at the time. Manual `/publish-now` stays the only immediate bypass.
**Fix (UI):** `PostCard.tsx:204` — "Publish (safe)" label is misleading (blocked in Safe mode). Clarify label/title.
Files: `src/orchestration/executor/workflow-executor.ts`, `web/src/components/PostCard.tsx`.

## Phase 02 — Leads liveness in poll cycle · [pending]
**State:** `checkPostLinks`/`checkPlatformAlive` (tri-state, self-heal, sets `leadCollectorStatus='post_deleted'`) exist but on-demand only. Poller only detects death reactively via `PostGoneError`.
**Fix:** after per-post poll loop in `comment-poller.ts`, call `checkPostLinks(post)`; add `leadCollectorStatus: { not: 'post_deleted' }` to the due-query; throttle liveness via `lastLivenessCheckAt` field to avoid an extra API call every 30-min tick.
Files: `src/leads/sources/comment-poller.ts`, `prisma/schema.prisma` (+ migration).

## Phase 03 — Media cost visibility + uniform funnel · [pending]
**State:** media DOES record USD via `recordMediaCost`, but `totalTokens=0` → 0 credits (invisible in Usage/credits); all media share `surface:'orchestration'`; Veo hardcodes 8s + literal `'veo-3.1-lite'`.
**Fix:** (a) media rows carry synthetic credits from USD so Usage reflects media spend; (b) per-agent `surface` (image/storyboard/video) for breakdown; (c) Veo uses real duration + `env.VEO_MODEL`; (d) document/enforce that every LLM/media agent routes through the cost funnel (future agents included).
Files: `src/cost/llm-usage.ts`, `src/cost/credits.ts`, `src/orchestration/executor/agent-runners.ts`, `src/orchestration/executor/node-cost.ts`, `src/video/veo.ts`.

## Phase 04 — Product knowledge: copy parity + surfacing · [pending]
**State:** single-product library + dropdown already built (`PostBriefForm.tsx:155`). Media grounds off FK chain (`resolveProductKnowledge`) but copy-gen reads only `campaign.brandContext` → post-level product selection does NOT affect copy. Dropdown missing at some post-creation surfaces.
**Scope (per user):** NOT multi-product. (a) copy-gen honors selected product FK (campaign fallback preserved); (b) surface the library dropdown where posts are actually created so a reused flow can swap product.
Files: `src/copygen/resolve-config.ts`, `src/copygen/service.ts`, `web/src/components/*` (post-creation surfaces).

## Order: 01 → 02 → 03 → 04. Verify each with tsc + targeted run before next.
