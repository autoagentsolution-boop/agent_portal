# Development Roadmap

Living tracker for the MKTAgent backend — the plain-TS marketing pipeline ported from the
n8n workflows, on `pivot/video-content-farm`. Status reflects `main`/branch reality, not
aspiration.

## Now

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

- **Node wiring on the DAG** — per-node config/credential surfacing still deferred
  (flagged in flow-creation UX work).
- **Publisher live path** — currently DRY for demo; live connect 500s when app-creds
  absent. Needs the OAuth app-cred provisioning story before real posts.
- **Multi-post campaigns** — cardinality is 1 run : 1 post today; manual posts stay
  run-less. Fan-out one run → many posts is out of scope until a driver appears.
- **Scheduler / leads / copygen** polish from the original port backlog.

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
