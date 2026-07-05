# Next-session state — 2026-07-05 (end of day)

Snapshot for resuming. Branch `pivot/video-content-farm`, pushed through **`5804f97`**. Repo
https://github.com/autoagentsolution-boop/agent_portal (private). Working tree clean.

## ⚠ DO THIS FIRST (before any manual testing)
1. **Rebuild the container** — `mktagent-app-1` still runs OLD code (no bind-mount; see the
   "Docker no bind-mount" memory). From `MKTAgent/`:
   `docker compose up -d --build --force-recreate`
2. The **3 migrations applied today** are already on the shared Postgres (localhost:5433) — the
   rebuilt app will match. Migrations (all additive/nullable):
   - `20260705130613_post_platform_assets` (Post.platformAssets + assetMedia)
   - `20260705133136_product_knowledge_library` (ProductKnowledge + FKs)
   - `20260705141404_post_reference_image` (Post.referenceImage)
3. After rebuild, run the container integration test: `npx tsx src/orchestration/verify-api.ts`
   (needs the server up). It was updated but NOT run against the new code (stale container).

## What shipped today (all committed + pushed)
Two batches — see `docs/project-changelog.md` (2026-07-05) for the full list.

**A) The 6 "tomorrow-plan" items** (commits `5dc96ec` → `1de445f`):
1. Per-platform asset-type validation (postability = adapter truth).
2. Auto-publish by default (gate only when a target can't take its asset).
3. Publish review at the gate (`GET /posts/:id/postability`).
4. concept_writer↔copy-gen boundary (documented, not merged).
5. Per-platform asset type (platformAssets/assetMedia; brief-form picker).
6. Product Knowledge library (reusable entity + dropdown + save-to-library).

**B) Concept versions + reference image** (commits `46e5cfa` → `5804f97`):
- concept_writer → 4 versions; **selection gate pauses the flow** for the user to pick.
- Optional reference-image upload conditions media gen (edit mode), or becomes the media
  when there's no media step.

## Verify status (all green today, run from MKTAgent/)
`npm run typecheck` + web `npm run build` clean. DB/pure verifies green:
`verify-concept-gate` (17), `verify-per-platform-publish` (18), `verify-library` (14),
`verify-postability` (13), `verify-executor`, `verify-rerun-node`, `verify-template-instance`,
`verify-post-platform-inherit`. Container-HTTP `verify-api` = **pending rebuild**.

## Behavior changes to keep in mind
- **Every flow now PAUSES at concept** (conceptGate default ON) so the user picks a version.
  Auto-publish still applies AFTER selection. To run a flow headless, send `{ conceptGate: false }`
  (and/or `{ autoPublish: false }`) in the `POST /orchestration/runs/:id/execute` body.
- Publisher auto-runs unless a target can't take its per-platform asset (then it gates with the
  review). Pre-video cost gate unchanged.

## Deferred (not blocking)
- Master-Agent per-platform asset picker (brief-form picker covers the core).
- Full CRUD Product-Library management panel (rename/delete/merge UI) — capture+select+ground done.
- Known limit: one storyboard run yields ONE asset type; a post needing BOTH carousel AND video
  keyframes favors carousel (rare).

## Plans (this session)
- `plans/260705-1920-product-knowledge-library/` (items 1-6)
- `plans/260705-2051-concept-variants-and-reference-image/`

## Memory (loaded each session)
- `project_tomorrow_plan_items_done.md` — the 6 items.
- `project_concept_versions_reference_image.md` — versions + reference image.
