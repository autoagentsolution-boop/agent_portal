# Session state — 2026-07-02 (resume here)

Branch `pivot/video-content-farm`. Buyer demo target was Fri 2026-07-03.

## Where things stand

**Committed + pushed** (last commit `89dc994`):
- `0e75e91` Phase 6 token/cost dashboard (migration `node_token_cost`)
- `0dd2afe` platform override in campaign-from-flow
- `5aeadc6` agent create-post clarify + sidebar tree indent fix
- `89dc994` conversational refine fix (chat-run lookup → `templateId=null`)

**Done but NOT committed** — the 4 post-execution UX fixes (~15 files, no migration):
1. Rerun dead-end → run parks at `planned` (resumable), Execute reappears as "Continue"
2. Inline copy edit (`POST /posts/:id/edit-copy`, no LLM) + Refine on concept artifact
3. Connection gate → redirect to Connections page (onOpenConnections threaded)
4. Removed Drive/Hero brief inputs → disabled Media-storage picker (Local | Drive coming-soon)

Backend tsc + web build + openapi/schema.d.ts regen all clean. 2 e2e probes green
(rerun-resumable, edit-copy). Detail in memory `project_post_exec_ux_fixes.md`.
**Next:** user real-tests these + a real publish, then commit the batch.

## Running services (leave up or restart)
- web Vite `:5173` (hot reload)
- backend `tsx watch` `:7100` (hot reload — source changes live; a schema/migration change
  needs the running process to restart, done this session already)
- Postgres Docker `:5433` (`mktagent-postgres-1`)

Restart recipe if down: `docker compose up -d postgres` (in MKTAgent/), then
`npm run dev` in MKTAgent/ and in MKTAgent/web/.

## Real-publish test notes
- Publishing is LIVE via the publisher node (gated behind the approval halt). The
  Safe/Live toggle on the campaign board gates it: **Safe = blocked** (no real post),
  **Live = one controlled real post**.
- Publisher needs a CONNECTED platform (Connections page). Unconnected → the run stops at
  `needs_connection` at $0 before the DAG runs; connect there then Continue/Execute.
- Memory rule: no burst real posts (Meta 24-48h ban risk) — one deliberate post at a time.
- `heroFile` must resolve to a fetchable asset. Locally-generated images are `local:<path>`
  and served at `/media/images`, but IG/Threads need a PUBLIC url — a `local:` ref can fail
  the fetch on those platforms (see assets/store.ts). FB is the safest first live test.

## Open / deferred
- Deferred earlier, still open: none blocking. The 4 UX fixes await commit after real test.
- If real publish fails: check (a) platform connected, (b) Live mode on, (c) heroFile
  resolvable for the target platform, (d) backend log for the publish path error.
