# Flow ↔ Post Convergence

## STATUS (2026-07-01)
- **P1 Connect via form — DONE** (no migration). verify-connect-form 10/10.
- **P2 Post.runId + DAG under post — DONE** (migration `20260701064554_post_run_link`). verify-executor +runId assert.
- **P3 Preflight honors form creds — DONE**. resolver `defaultTokenStatusReader` union.
- **P4 Single-node re-execute — DONE**. verify-rerun-node 14/14 + HTTP guards.
- **P5 Text-refine + per-post voice/angle — DONE** (migration `20260701090147_post_voice_angle_overrides`). verify-refine 8/8.
- **P6 Master Agent creates campaigns/posts — DONE** (no migration, no openapi change). Save-offer author + `recordSaveOffer` + in-chat `SaveOfferCard` (set up campaign $0 / run test post ~$0.06 / open flow) + hero "flows without strategy" hint. verify-save-offer 9/9.
- NOT committed / NOT pushed. Backend+web tsc clean, web build clean. ⚠ run `npx prisma generate` after any `migrate dev` before tsc.

## Context

Two parallel systems exist and the UX exposes the seam between them:
- **Orchestration Flow/Run DAG** — Master Agent plans a DAG (Ideation→Strategy→Concept→Infographic→Publisher); executor runs it whole; each node writes a typed artifact. `concept_writer` materializes **1 Campaign + 1 Post** and stamps `Campaign.flowId = runId`.
- **Campaign→Post pipeline** (ported n8n) — linear `brief→review→ready→posted`; copy owned by copy-gen; no run link on the Post.

User feedback (manual testing, screenshots):
1. Clicking **Connect** on a platform → `{"error":"connect_not_configured","details":"META_APP_ID not set"}`. Wants a **form** to enter platform credentials, and publish to actually use them.
2. Clicking a post shows only the **last step**, not the whole workflow. Wants the **full DAG under each post**, clickable, where a node can be **re-executed** to regenerate its output before Publisher posts.
3. Copy **can't be edited, only regenerated**. Wants regen-only kept but add a **text-refine** ("chỉnh nhẹ bằng chữ") path.
4. On flow execute (test), verify the workflow **runs and flags missing credential/connection**.
5. At Campaign/Post level, each should carry its **own plan / brand-voice / strategy**.
6. **Master Agent** should be able to **create & set up** campaigns/posts for the user conversationally.

Approved direction (this session's decisions): **full convergence, multi-phase**; DAG under post is a **control surface** (click node → re-run to regenerate); copy stays **regen-only + text-refine**.

## Architectural spine (the one decision everything hangs on)

Add an explicit **`Post.runId`** (nullable FK → WorkflowRun, `SetNull`). This is the convergence key:
- `concept_writer` stamps it when it creates the Post (it already has `ctx.runId`).
- A Post's DAG = its run's nodes/artifacts (no fragile Campaign join for the hot path).
- Manually-created posts have `runId=null` → board shows "no workflow yet" and offers Master-Agent generation (Phase 6).
- Re-running a node operates on **that run**, and its artifacts flow back into **that Post** (concept→`copy`, infographic→`heroFile`) exactly as first-run does.

Cardinality stays **1 run : 1 post** (today's reality). Multi-post campaigns keep manual posts as run-less until generated. No attempt to make one run fan out to many posts this session.

## Phases

### Phase 1 — Connect via form (feedback #1, #4) — SMALL, highest value
Backend plumbing already exists (Credential Vault, `AgentCredential` table, `/agent/credentials/*`, per-platform keys in allowlist). The only gap: adapters read `getActiveToken()` from `OAuthToken` **only**.

- `src/tokens/service.ts` — `getActiveToken()` fallback: after `OAuthToken` miss, read `AgentCredential(ownerId, 'publisher', '<platform>_access_token')`, decrypt, return. Keeps OAuth-first, form-second.
- Reuse existing `PUT /agent/credentials/:agentId/:key` to store form values (no new endpoint). Re-add a **minimal** web client method (we deleted them last change) — only what the form needs.
- Web: `ConnectionsPanel` — when a platform is `not_connected` and OAuth isn't configured, reveal a small inline form (app id/secret/token per platform, driven by the existing per-platform key list). Write via the credentials endpoint. This is the "setup lives in Connections" model already agreed.
- Connection state: teach `GET /connections` (`connections-router.ts`) to also count a stored `*_access_token` credential as `connected` so the dot + the Phase-3 preflight both see form creds.
- Files: `src/tokens/service.ts`, `src/api/connections-router.ts`, `web/src/components/ConnectionsPanel.tsx`, `web/src/api/client.ts`. **No migration.**

### Phase 2 — Post ↔ Run link + DAG under each post (feedback #2, read side)
- **Migration**: `Post.runId String? @db.Uuid` + FK to `WorkflowRun` (`onDelete: SetNull`) + index.
- `agent-runners.ts::runConceptWriter` — pass `runId: ctx.runId` into `createPost(...)`.
- `post-repo.ts` / `createPost` — accept + persist `runId`.
- Post DTO (`mappers.ts`, `schema.d.ts` regen) — expose `runId`.
- Web `PostCard` — when `post.runId`, render `RunDagView` (existing component) under the card, fed by a fetched run. Reuse `useRunEvents` for live dots. Read-only artifact view per node (reuse `formatArtifact`, incl. the restored image path).
- Files: `prisma/schema.prisma` (+migration), `src/orchestration/executor/agent-runners.ts`, `src/db/repos/post-repo.ts`, `src/api/mappers.ts`, `web/src/components/PostCard.tsx`.

### Phase 3 — Preflight on execute: verify run + flag missing connection (feedback #4)
Connection Resolver gate already exists (`needs_connection` halts a run at $0 before the DAG). Confirm the publisher node's required platforms are checked against **both** OAuthToken and form credentials (depends on Phase 1's `/connections` change). Surface the same `ConnectionRequired` card inline under the post's DAG, not only in SavedFlowDetail.
- Files: connection resolver (`src/connectors/...` — locate in impl), `web/src/components/PostCard.tsx` (reuse `connection-required.tsx`).

### Phase 4 — Single-node re-execute (feedback #2, control surface) — MEDIUM, executor surgery
Today the executor runs the whole DAG; nodes `completed`/`skipped` are skipped on resume. Add targeted re-run:
- **Endpoint**: `POST /orchestration/runs/:id/rerun-node/:nodeId`. Validation: node not `running`; its `dependsOn` all `completed`; publisher re-run still honors the approval gate.
- **Repo**: `resetNode(nodeId)` → status `pending`, clear `error`/`finishedAt`; `deleteArtifactsByNode(runId, nodeId)`.
- **Executor**: add `rerunOnly?: string` to `ExecuteOptions`. When set, execute only that node (seed `upstream` from existing artifacts of its dependencies), then **cascade-invalidate downstream** dependents (reset them to `pending`) so stale concept→image→publish don't post outdated output. Re-run stops before publisher (gate).
- **Web**: in the post's `RunDagView`, a selected node gets a **"Re-run this step"** button (guarded to non-publisher, non-running). SSE drives the live dots; terminal refetch repopulates the post's `copy`/`heroFile`.
- Files: `src/orchestration/executor/workflow-executor.ts`, `src/db/repos/workflow-run-repo.ts`, `src/orchestration/executor/artifact-store.ts`, `src/api/orchestration-router.ts`, `web/src/components/run-dag-view.tsx` + `PostCard.tsx`.

### Phase 5 — Text-refine copy + per-post/campaign voice (feedback #3, #5)
- **Text-refine**: `POST /posts/:id/refine { instruction }` — regenerates copy through Gemini with the instruction as a targeted edit directive (distinct from `reject`+full-feedback). Keeps audit trail (LLM-mediated, no hand-edit). Reuse `generateForPost` path with an extra "refine instruction" input threaded into `prompt.ts`.
- **Per-post voice/strategy**: add nullable `Post.brandVoice`, `Post.angle` (and optionally `Post.strategyNote`) overrides; extend `resolve-config.ts` layer order Post→Campaign→User. Migration.
- Web `PostCard` — a "Refine" box (instruction → refine) and an optional per-post voice/angle override in the brief form.
- Files: `prisma/schema.prisma` (+migration), `src/copygen/resolve-config.ts`, `src/copygen/prompt.ts`, `src/copygen/service.ts`, `src/api/posts-router.ts`, `src/api/schemas.ts`, `web/src/components/PostCard.tsx` + `PostBriefForm.tsx`.

### Phase 6 — Master Agent creates & sets up campaigns/posts (feedback #6)
- After a flow is approved/saved, Master Agent offers (conversationally): "Tạo campaign + post đầu tiên để bắt đầu?" / "Đăng thử 1 post để test hệ thống?" If yes → it already can (execute the run → concept_writer materializes them). If no → redirect to the saved flow; on return, suggest flows that have no campaign/strategy yet.
- Wire the offer into the Orchestrate reply flow + a "flows without strategy" hint in the sidebar/empty state.
- Files: `src/orchestration/master/*` (offer logic), `web/src/components/OrchestratePanel.tsx`, `App.tsx` (return-hint).

## Sequencing & risk
- **Ship Phase 1 first and independently** — it's the live blocker (can't connect any platform), small, no migration, unlocks Phase 3/4 testing.
- Phases 2→4 are the DAG-under-post convergence and must land together to be coherent (2 read, 3 preflight, 4 control).
- Phases 5–6 are additive polish; can be separate sessions.
- Migrations in 2 and 5 — additive, nullable, `SetNull`; no destructive change. Run `prisma migrate dev` in the Postgres container (port 5433).
- Regenerate `web/src/api/schema.d.ts` after each DTO/openapi change.

## Verification (per phase)
- **P1**: store a fake FB token via the form; `getActiveToken('facebook')` returns it; `/connections` shows connected; DRY-RUN publish path resolves the token (no real post — Safe mode).
- **P2**: run a flow → open the created post → full DAG renders with live dots; click infographic node → image shows.
- **P3**: disconnect a platform → execute → `needs_connection` card appears under the post at $0.
- **P4**: re-run the Concept node on a completed run → copy regenerates, downstream infographic resets + re-runs, publisher still gated. `verify-executor` + live HTTP.
- **P5**: refine instruction → copy changes on-target; per-post voice overrides campaign.
- **P6**: approve a flow → offer appears → accept creates campaign+post; decline redirects to saved flow.
- Each phase: `tsc --noEmit` (backend + web), `npm run build` (web), existing `verify-*` scripts green vs rebuilt state, then manual e2e on 5173.

## Open questions
- Cascade-invalidate on node re-run: auto-reset downstream (safer, may re-spend on image/video) vs. mark-stale-and-let-user-choose? Leaning auto-reset up to (not including) publisher — confirm before Phase 4.
- Per-post `strategyNote` — needed, or are `brandVoice`+`angle` overrides enough? Confirm at Phase 5.
