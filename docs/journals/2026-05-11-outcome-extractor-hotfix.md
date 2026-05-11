# Outcome Extractor Hotfix + Run Now UX Sweep

**Date**: 2026-05-11 12:50
**Severity**: High (demo blocker)
**Component**: Business outcome extractors (BE), Run Now flow (FE)
**Status**: Complete — 3 commits local, awaiting push

## What Shipped

Three commits land on `main` after Phase 16:

| SHA | Type | Scope |
|---|---|---|
| `594aa33` | fix(analytics) | Outcome extractors unwrap `.data` + normalize `lead_type` |
| `31bfc54` | feat(ux) | Unified Run Now flow (card→detail, Config tab CTA, exec re-run primary) |
| `d6e053f` | chore(backend) | Prisma CJS shim documented + Docker rebuild contract in README |

## Root Cause — Bug 2 (outcome panels empty in demo)

`ExecutionOutput.outputJson` shape diverges between templates:

| Template | Shape |
|---|---|
| gmail-lead-classifier, email-draft-responder, ticket-triage-agent, google-sheet-data-checker | `{ data: {classifications/drafts/tickets/rows, items_processed}, summary }` |
| slack-daily-summary | `{ risks, action_items, items_processed, summary }` (flat) |

All 5 extractors uniformly read top-level (`o.classifications`, `o.items_processed`, etc.) → 4/5 returned 0 across every metric. Slack happened to work because its template emits flat payload.

Fixed with `unwrapData(v)`: returns `payload.data` when present as a record, else returns the raw record. Applied to all 5 extractors — slack becomes a no-op for its current shape but inherits robustness if upstream changes.

**Bonus bug**: gmail-lead-classifier matched `lead_type === 'hot' | 'warm' | 'cold'` but DB stores `hot_lead`, `warm_lead`, `cold_lead`, `not_relevant`. Strip `_lead` suffix before compare; `not_relevant` correctly falls through (counted toward total items but neither hot/warm/cold).

## Why It Wasn't Caught

No unit tests on extractors — registry was wired in Phase 14, but tests only covered the analytics endpoint with mocked extractor return values. The shape mismatch only surfaces against real n8n output, which the demo seed produced after registry wiring shipped.

**Action**: extractor unit tests are NOT in scope for hotfix (KISS for demo). Backlog: add fixture-driven test per template using a snapshot of real `outputJson` from `ExecutionOutput`.

## Bug 1 — Parameter Override Persistence (NOT FIXED)

User expected: edit params in Run Now modal → next modal-open remembers values. Actual: modal always seeds from `AgentInstance.config` (the saved defaults). Plan line 40-42 of Phase 15 explicitly chose snapshot-only persistence (per-Execution columns). Spec-compliant, not a code bug.

UX mitigation shipped instead: promote `Run again with these overrides` button on execution detail to primary variant. Plan acknowledged — if user testing still shows expectation gap, escalate to Option C (auto-persist to `AgentInstance.config` on every run; 30-min effort, semantic change).

## UX Sweep

| Issue | Fix |
|---|---|
| Card Run Now bypassed override modal | Card now navigates `/agents/:id?run=1`; detail page consumes query, opens modal, strips it via `useSearchParams.delete + setSearchParams({replace})` |
| Config tab footer "editing ships later" | Replaced with read-only callout + `Run with overrides` CTA wired to same modal opener as header button |
| `Run again with these overrides` low visibility on execution detail | Variant: outline → default (primary) |

## Non-Obvious Decisions

**Why patch generated Prisma client instead of switching generator**: `prisma-client-js` (legacy CJS-friendly) would force re-import path audit across the backend AND re-run the migration history. With 15 days to demo, a 1-line patched line + `@ts-nocheck` + warning comment is the lower-risk play. Tracked separately as new phase `260511-1252-prisma-cjs-cleanup/`.

**Why `docker cp` then full rebuild**: docker compose has no bind mount (see `project_docker_no_bindmount.md` memory). `cp` got the fix into the running container in 5 seconds for live verification before committing source. Final rebuild then guarantees `docker-compose down/up` from clean state works for future presenters.

## Blockers & Quirks

`git remote -v` shows no remote configured — push to `origin/main` failed with `'origin' does not appear to be a git repository`. Not an auto-mode classifier issue (session summary's claim was incorrect). User must either configure a remote or accept this is a local-only repo.

CRLF line-ending warnings on every commit. `core.autocrlf = true` on Windows. Not fixable without team-wide `.gitattributes`.

## Verification

- `npm test` (backend): 16/16 pass
- `npx tsc --noEmit` (frontend): clean
- Extractor sanity (in container, against real outputJson from DB):
  - gmail: 3 leads / 1 hot / 1 warm / 33.33% rate
  - email-draft: 2 drafts / 2 approved / 4 avg words
  - ticket-triage: 5 tickets / 1 high / 1 negative
- `docker compose up -d --build`: both services Up, no Prisma crash, health endpoint 200

## Next Steps

- User pushes 3 commits (after configuring remote or accepting local-only)
- Hard-refresh browser, run smoke test checklist in summary report
- If outcome panel still shows zero for any agent: check that agent's templateId is in registry (`backend/src/modules/analytics/business-outcomes/registry.ts`)
- New phase `260511-1252-prisma-cjs-cleanup/` tracks long-term fix for generated client
