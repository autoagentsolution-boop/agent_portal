# Flow-creation UX + §11.15 hardening (DONE 2026-07-01)

> Status: **DONE & PUSHED** — commit `4706f1f` on `pivot/video-content-farm`
> (also pushed the 7 prior local-only commits: connector layer P1-P5, multi-language
> reply, sidebar IA, Master-Agent removal). All parts A/B/C + the 3 hardening pieces
> shipped and verified live against Postgres. Manual UI e2e pending user feedback.
>
> ## What shipped
> - **A** — `+ New flow` and the Flows empty-state open Orchestrate chat (not campaign-
>   create); static `brandingVideoFlow` demo landing retired. `ActiveFlowsPage` reduced
>   to 3 real states (saved run → `SavedFlowDetail`, campaign → `PostBoard`, empty-state).
> - **B** — inline rename on `SavedFlowDetail` (pencil) via new `PATCH /orchestration/runs/:id`
>   + `renameRun` repo (any status, owner-scoped; unlike `/save` which is planned-only).
> - **C** — per-agent credential setup folded onto REAL flow nodes; config extracted to
>   `web/src/flow/agent-credentials.ts` + reusable `AgentCredentialPanel`. ⚠ credential
>   allowlist RE-KEYED (backend `agent-router.ts` + web) to canonical snake_case registry
>   ids (`concept_writer`, `video`, `content_search`); old kebab ids retired (→ 422).
>   Node WIRING still deferred (future feature).
> - **Hardening (§11.15)** — `idempotency-manager` (audit-log-backed, NO migration; key set
>   in `runtimePublishFn`), `rate-limit-manager` (per owner+platform, in-process),
>   `withRetry` wired into `invokeAction`. All dormant under DRY (no live posting yet).
>
> ## Verified
> tsc + web build clean; verify-runtime/registry/vault/audit/connection-resolver/
> executor(DRY)/api green; new `verify-rename-and-creds` 12/12; idempotency JSONB lookup
> validated against live Postgres (error rows not deduped, cross-tenant isolated).
>
> ## Known limits (flagged, not blockers)
> - Re-key orphans any old kebab-keyed credential rows in dev DB (show "missing", re-enter).
> - Rate-limit is single-process (needs Redis for multi-instance); retry only catches
>   genuine transport throws (adapter swallows most failures into `ok:false`).
> - README.md P6-P8 (lines 39-40) = the SEPARATE n8n-backend-port roadmap — untouched.

---

_Original plan below (kept for reference)._

# Next session — Flow-creation UX + P6-P8 (planned 2026-07-01)

> Status: **NOT STARTED.** Feedback captured 2026-06-30 (Addflow.png). Implement next session.
> Branch `pivot/video-content-farm`. All of today's work (P1-P5 connector layer, multi-language
> reply, sidebar IA, Master-Agent removal) is committed but NOT pushed.

## The feedback (Addflow.png)

User clicked into the **Active Flows** view ("Branding / Social Video Post Flow") and hit three gaps:

1. **Can't rename the flow.** The title is fixed text.
2. **Can't click an agent node to set it up** in a meaningful way (the nodes — Find Content, Write
   Concept, Create Infographic, Storyboard, Voiceover Video, Publish — only open a credential panel).
3. **Can't chat with the Master Agent** to define what the new flow should do.

### Root cause (verified in code)

The screen in Addflow.png is **NOT a real flow** — it is the hardcoded demo template
`brandingVideoFlow` (`web/src/flow/demo-flow.ts`), rendered by `ActiveFlowsPage.tsx` whenever
`page === 'flows'` with no specific flow/campaign selected. Its agent chips (`agent-strip`) only open
`AgentDetail` for credential entry. It has no name field, no plan, no chat — because it isn't backed by
a `WorkflowRun`. A **real** flow is a saved `WorkflowRun` (created via Orchestrate), opened through
`SavedFlowDetail.tsx` — that one HAS a name, a real DAG, execute/approve, and the connection gate.

So today's "Flows" tree mixes two different things:
- The static `brandingVideoFlow` demo (the default `page==='flows'` landing) — a mockup.
- Real saved runs (`savedRuns`) — the actual flows.

And the `+` next to "Flows" currently creates a **campaign** (`createCampaignUnder(e, null)`), NOT a
flow. There is no "create a flow" entry point in the tree at all — flows are only born from Orchestrate.

## The decision (user, 2026-06-30)

> **"Add new flow" should redirect to the Master Agent (Orchestrate) to set up the need via chat.
> Letting the user wire agent nodes together manually is a FUTURE feature, for when the app has grown
> strong enough."**

So: **a flow is always created by describing intent to the Master Agent**, never by hand-assembling a
node graph (yet). The manual node-graph builder is explicitly deferred.

## Scope for next session

### A. Flow-creation entry point → Orchestrate
- Add a real **"+ New flow"** affordance at the Flows level that calls `openOrchestrate()` (fresh
  Orchestrate chat) — NOT `createCampaignUnder`. The existing `+` that makes a campaign stays (move it
  onto a flow row only, or relabel), so the two actions aren't conflated.
- When Orchestrate saves a run (`onSaved` → `openSavedFlow`), it already lands in the real
  `SavedFlowDetail`. That is the correct "new flow" path — wire the button to it.
- Decide the fate of the static `brandingVideoFlow` demo: either (a) retire it like we retired the old
  Master Agent surface (replace the empty `page==='flows'` landing with a real empty-state that says
  "Create a flow → opens chat"), or (b) keep it clearly labelled as a sample. Recommend (a) for
  consistency with the Orchestrate-only direction.

### B. Rename a flow
- `SavedFlowDetail` shows `run.name`. Add an inline rename (pencil affordance) → reuse the existing
  `POST /orchestration/runs/:id/save` (it sets `name`; backend already there — `nameRun` in
  workflow-run-repo). NOTE: today `save` only works from status `planned`; renaming an already-executed
  flow needs the guard relaxed (allow rename in any status, or a dedicated `PATCH /runs/:id` name-only).
  Smaller: a `PATCH /orchestration/runs/:id { name }` that updates name regardless of status.

### C. Agent-node setup (within a real flow)
- In `SavedFlowDetail`, clicking a DAG node already shows its artifact. The feedback wants node-level
  SETUP (credentials/config per agent) too — fold the `AgentDetail` credential panel (currently only on
  the static demo) into the real flow's node click, keyed by the node's `agentId`. The credential
  backend (`/agent/:agentId/credentials`) already exists; just surface it on real nodes.
- Manual node WIRING (add/remove/reorder agents in the DAG) = explicitly DEFERRED per user.

## CORRECTION — there is NO "new P6-P8"

⚠ I previously mis-wrote that there are "new P6-P8 to define." That was a GUESS and it is WRONG. The
original plan (`ti-p-t-c-i-toasty-bengio.md`) only ever had **P1-P5** (my own numbering for the
connector/credential slice). The user reminded me they said "do P1-P5, defer 3 parts to fix bugs first."

### What "P1-P5" actually mapped to (vs brief §12's 8 canonical phases)
The brief §12 (lines 1509-1517) defines 8 phases for the whole §11 program. Phases 1-3 (Agent Registry,
Clarification, Artifact Store) were ALREADY done in M1. My "P1-P5" today = the **connector/credential
portion** (brief Phases 4-8), and it is essentially COMPLETE except production hardening:

| §11.16 step | Item | Status |
|---|---|---|
| 1 | Schemaless Connection Layer (core schema + JSONB meta) | ✅ already existed (`OAuthToken.meta Json?`) |
| 2 | Credential Vault | ✅ P2 today |
| 3 | Connector Registry | ✅ P3 today |
| 4 | Capability-based planning | ✅ existed + P1 resolver |
| 5 | Connection Resolver | ✅ P1 today |
| 6 | Connector Runtime | ✅ P4 today |
| 7 | Platform Adapter pattern (shared interface) | ⚠ PARTIAL — 5 adapters share `SocialAdapter`, not yet restructured into `/platforms` |
| 8 | Human approval before external write | ✅ already existed (executor approval gate) |
| 9 | Audit logs | ✅ P5 today |
| — | **retry + rate-limit + idempotency** (§11.15) | ❌ THE DEFERRED PART |

### The "3 deferred parts" = production hardening (brief Phase 8 tail / §11.15)
My P5 plan literally said "Audit log **+ hardening** (idempotency + rate-limit §11.15)" but I shipped
ONLY the audit log. The 3 deferred pieces are:
1. **Retry** — wire the existing `withRetry` (lib/retry.ts) into Connector Runtime's invokeAction.
2. **Rate-limit manager** (§11.15 `rateLimitManager.ts`).
3. **Idempotency manager** (§11.15 `idempotencyManager.ts`) — today `idempotencyKey` is only CARRIED
   through invokeAction (connector-runtime.ts:25-26 "reserved … enforced later"), NOT enforced/deduped.
(Optional 4th: restructure the 5 adapters into the formal `/platforms` folder per §11.15 — cosmetic.)

### Two questions the user raised — ANSWERED (so we don't re-investigate)
- **"Result of one agent → input of the next"** → ✅ ALREADY COVERED since M1 (NOT today's work).
  `workflow-executor.ts:91` `upstream[result.type] = result.data`; downstream node reads `ctx.upstream`.
  That is the Artifact Store / Agent Contracts (brief Phase 3), done long before this session.
- **"Schemaless credential"** → ✅ ALREADY EXISTS — `OAuthToken.meta Json?` is the schemaless JSONB core;
  P2 vault added the pluggable secret boundary on top. Nothing outstanding here.
- **Today's bug-fixes (language / loading / sidebar / delete / Master-Agent removal) did NOT touch the
  connector layer and do NOT affect the 3 deferred parts or M2.** They are independent frontend/UX work.

### Priority for next session (user: "flow creation chắc chắn phải sửa")
1. **Flow-creation UX (above)** — CONFIRMED must-fix (Addflow.png). Do this first.
2. The 3 hardening parts (retry/rate-limit/idempotency) — finish the §11 program when ready. NOT urgent
   (no live posting yet; DRY-only demo). User wary of scope — keep these small + clearly bounded.
Confirm exact scope/order with the user at session start before coding.

## Reuse / seams (so next session doesn't re-explore)
- `openOrchestrate()` (App.tsx) — fresh Orchestrate chat; already the create-a-flow path via `onSaved`.
- `SavedFlowDetail.tsx` — the real flow view (name, DAG, execute, gate). Where rename + node-setup land.
- `nameRun` (workflow-run-repo.ts) + `POST /runs/:id/save` — naming; relax the `planned`-only guard.
- `AgentDetail` + `/agent/:agentId/credentials` — per-agent credential panel to fold into real nodes.
- `brandingVideoFlow` (web/src/flow/demo-flow.ts) — the static demo to retire/relabel.
- Connection Resolver (`src/connectors/runtime/connection-resolver.ts`) — the generic gate to extend to
  new agents in P7.
