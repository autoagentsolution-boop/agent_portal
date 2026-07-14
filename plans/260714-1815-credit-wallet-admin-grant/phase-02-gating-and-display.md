# Phase 2 — Gating (block flow at 0, chat free) + balance in UI

**Priority:** P0 · **Status:** ✅ DONE (2026-07-14, uncommitted) — 402 gate in `executePlannedRun` + `/test-run` + brain "run it" path; `/auth/me` echoes `credits`(balance)+`isSuperAdmin`; top-nav pill = remaining balance (loadCredits→`api.me()`); Usage page balance line; friendly 402 copy across all 4 execute call-sites. Bonus: **logout button** wired (`TopNav.onLogout`→`auth.logout`). Verified by `verify-credit-gating-and-admin-http` 9/9. · **Depends on:** Phase 1

## Overview
Enforce the balance: block starting a FLOW when the tenant can't afford it; keep chat/planning free. Flip the top-right credit number from cumulative SPEND → remaining BALANCE.

## Gating (backend)
- Pre-flight check in `POST /runs/:id/execute` (+ the brain's `execute_workflow` path): if `getBalance(ownerId) <= 0` → return `402 insufficient_credits` with `{ balance, needed? }` and DO NOT execute.
- Optional: estimate the run's cost (sum of node budgets) and block if `balance < estimate`; simplest v1 = block only at `<= 0`.
- Chat (`POST /runs` conversational turns, brain) is NEVER gated — the reasoning brain stays free (loss-leader). Only the executor path checks balance.
- A run already RUNNING is allowed to finish (may go slightly negative) — the gate is at START only.

## UI
- Top-right credit pill: show **remaining balance** (from a new `GET /me/credits` or fold into `GET /auth/me`). Keep raw spend on the Usage page.
- On `402 insufficient_credits`: a clear inline message on the flow card — "You're out of credits. Ask your admin for more." (localized, per the reply-language rule). No dead-ends.
- Usage page: add a "Balance" line alongside spend.

## Files
- Modify: `orchestration-router.ts` (execute gate + `/me/credits` or `/auth/me`), `atria/atria-tools.ts` (execute_workflow gate signal), web: the top-nav credit pill component, the flow-card error handling, Usage page.

## Success criteria
- Tenant at 0 credits: chat/plan works, but "Approve & run" → 402 + a clear top-up prompt (no crash, no fake run).
- Tenant with credits: flow runs, balance decreases by the run cost.
- Top-right shows remaining balance and updates after a run.
- `verify-credit-gating.ts`: 0-balance blocks execute, >0 allows, chat never blocked.

## Risks
- Don't gate the connection-gate/parked paths incorrectly — the credit gate is a SEPARATE pre-flight from the needs_connection gate. Order: credit gate → connection gate → run.
