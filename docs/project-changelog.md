# Project Changelog

Significant changes to the MKTAgent backend (the plain-TS marketing pipeline on
`pivot/video-content-farm`). Newest first. Commit hashes are on that branch.

## 2026-07-01

### Flow ↔ Post convergence — P1–P6 (`b2415eb`)
Converged the two parallel systems (Orchestration Flow/Run DAG ↔ Campaign→Post pipeline)
so a post exposes its whole workflow and the Master Agent can guide setup. One commit,
48 files, 2 migrations. All verify suites + Puppeteer browser e2e green; DRY (no real posts).

- **P1 Connect via form** (no migration) — `getActiveToken()` falls back to the credential
  vault (`publisher/<platform>_access_token`) after an OAuth miss, fixing the
  `META_APP_ID not set` connect blocker. `/connections` counts form creds as connected;
  inline token form in ConnectionsPanel.
- **P2 Post.runId + DAG under post** (migration `20260701064554_post_run_link`, SetNull) —
  `concept_writer` stamps `Post.runId`; `RunDagView` renders under each PostCard with live
  SSE dots + clean artifact view (image restored).
- **P3 Preflight honors form creds** — connection-resolver unions OAuthToken + form-cred
  platforms so the $0 pre-execution gate sees both.
- **P4 Single-node re-execute** — `POST /orchestration/runs/:id/rerun-node/:nodeId`; resets
  target + transitive downstream to stale (NOT auto-run — keeps image/video spend
  deliberate); publisher re-run blocked (approve-node gate).
- **P5 Text-refine + per-post voice/angle** (migration `20260701090147_post_voice_angle_overrides`) —
  `POST /posts/:id/refine {instruction}` edits copy via LLM (audit trail kept);
  `Post.angle`/`Post.brandVoice` overrides layered post→campaign→user.
- **P6 Master-Agent save-offer** (no migration, no contract change) — after `/save`, the
  agent authors a guiding offer (set up first campaign $0 / run test post ~$0.06 / open
  flow) returned as `assistantMessage` + persisted on the chat; web `SaveOfferCard` + a
  "flows without strategy" hero hint. **Fix:** `nameRun` now guards on `name: null`
  (first-save-only) so a re-`/save` can't re-post the offer — caught by the live-HTTP e2e,
  missed by the DB-level test.

### Flow-creation UX + §11.15 hardening (`4706f1f`, `67182e5`)
- `+ New flow` / empty-state route into the Orchestrate chat; static `brandingVideoFlow`
  retired. Inline flow rename via `PATCH /orchestration/runs/:id` (any status).
- Per-agent credential setup on real nodes; allowlist re-keyed backend+web to snake_case
  registry ids (kebab → 422).
- §11.15 hardening: idempotency (audit-log, no migration) + in-process rate-limit + retry
  in `invokeAction`, dormant under DRY.

## 2026-06-30

- **Sidebar IA** (`993a212`) — merged Saved/Active Flows into one `Flows` tree
  (Flow→Campaign→Post); `Campaign.flowId` FK (SetNull); create at each level.
- **Retire old Master Agent setup surface** (`4993964`) — Orchestrate is the sole chat entry.
- **Connector/Credential Layer §11 P2–P5** (`d5da344`) — credential vault, connector
  registry, runtime, external-action audit log.
- **Connection Resolver gate** (`2008729`) — runs needing an unconnected platform stop at $0
  before the DAG.
- **Product knowledge + persona capture & Saved Flows UX** (`6c35373`).
- Language + sidebar fixes (`f146068`, `73b7aa4`, `065961c`).

_Earlier history predates this changelog; see git log and memory notes._
