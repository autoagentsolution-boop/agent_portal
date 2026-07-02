# Development Roadmap

Living tracker for the MKTAgent backend — the plain-TS marketing pipeline ported from the
n8n workflows, on `pivot/video-content-farm`. Status reflects `main`/branch reality, not
aspiration.

## Now

### Flow-as-Template · Post-as-Instance — ✅ DONE (2026-07-02, not committed)
The 3-tier IA rework: **Flow = frozen blueprint** (the approved agent "team", read-only,
never executed), **Campaign = strategy grouping**, **Post = execution instance** (clones
the flow DAG, runs independently). Resolves the old 1-run:1-post coupling.
- Data model: `WorkflowRun.kind` (template|instance) · `locked` · `templateId`
  (migration `flow_template_instance`, additive — legacy rows = instance, behaviour intact).
- Save (Approve) freezes a run → `kind=template, status=template, locked`; master-agent chat
  can no longer mutate it (forks a fresh run). Executing a template → 409 `template_not_executable`.
- Create a Post under a flow-attached campaign → `cloneTemplateRun` clones goal+DAG into a
  new instance run, links `post.runId`. Campaign with no flow keeps the legacy copy-gen path.
- `concept_writer` fills the pre-created Post on the instance path (no dup campaign/post);
  legacy path (no attached post) still materializes as before. Re-run resets post→brief.
- UI: Flow detail = blueprint (agent-team list + "New campaign from this flow"); Post
  workflow view = playground (DAG open by default + Execute + approve gate + re-run node).
- Verified: `verify-template-instance` (22 checks) + `verify-api` (updated to new model) +
  executor/rerun-node/save-offer/rename-creds/persistence/master/connect-form all green;
  container rebuilt; DRY throughout. **Token/cost dashboard deferred (Phase 6).**

### Flow ↔ Post convergence — ✅ DONE (2026-07-01, `b2415eb`)
Post exposes its whole workflow DAG; Master Agent guides campaign/post setup.
- P1 connect-via-form · P2 Post.runId + DAG-under-post · P3 preflight honors form creds ·
  P4 single-node re-execute · P5 text-refine + per-post voice/angle · P6 Master-Agent
  save-offer + "flows without strategy" hint.
- Verified: unit/DB + live-HTTP + Puppeteer browser e2e green; DRY throughout.

### Connector / Credential Layer §11 — ✅ DONE (2026-06-30)
Connection-resolver $0 gate, credential vault, connector registry + runtime, audit log,
§11.15 idempotency/rate-limit/retry hardening.

## Next (candidates — not yet scheduled)

- **Token/cost dashboard (Phase 6 of the template work)** — Flow blueprint becomes a real
  dashboard: aggregate token/$/errors across all instance runs (posts) sharing a
  `templateId`. Needs `WorkflowNodeRun` cost columns + capturing Gemini `usageMetadata`
  (currently discarded in `llm-json.ts` + copygen) and flat image cost at the executor's
  node-completion chokepoint.
- **Node wiring on the DAG** — per-node config/credential surfacing still deferred
  (flagged in flow-creation UX work).
- **Publisher live path** — currently DRY for demo; live connect 500s when app-creds
  absent. Needs the OAuth app-cred provisioning story before real posts.
- **Scheduler / leads / copygen** polish from the original port backlog.

## Resolved

- ~~**Multi-post campaigns**~~ — done 2026-07-02: a flow template now fans out to many
  posts, each its own instance run (Flow-as-Template above).

## Constraints & operating notes

- **Stack:** web = Vite dev `:5173`, backend = `tsx watch :7100`, Postgres = Docker `:5433`.
  Source is hot-reloaded — only Postgres is containerized. (No bind-mount rebuild trap here,
  unlike the Docker-packaged pipelines.)
- **Migrations:** run `prisma migrate dev` against `:5433`, then ALWAYS `prisma generate`
  before tsc or phantom "property does not exist" errors appear.
- **Publishing:** DRY-RUN by default (Safe mode). No burst real posts — Meta enforces
  24–48h restrictions. Verify logic layers separately.
- **Auth:** BFF model — HttpOnly `mkt_session` cookie (browser), JWT via `signSession`
  (CLI/tests). No token in the browser JS.

## Milestone history

- **M2** reached 2026-06-02 — pushed to private GitHub `autoagentsolution-boop/agent_portal`.
- See `docs/project-changelog.md` for dated change detail.
