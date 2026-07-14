# Phase 1 — Balance model + super-admin role + debit-on-flow

**Priority:** P0 (foundation) · **Status:** not started

## Overview
Add a real credit **balance** per tenant + an audit **ledger**, a **super-admin** role, a **trial grant** on signup, and **debit** the balance when a flow runs. No gating/UI yet (Phase 2).

## Schema (prisma)
- `User.isSuperAdmin Boolean @default(false)` — global admin flag.
- `CreditLedger` (`mkt_credit_ledger`): `id, ownerId, delta Int, kind (trial|grant|debit|adjust), reason String?, runId String?, grantedBy String?, createdAt`. Balance = SUM(delta). (Ledger-as-truth = auditable; add a cached `creditBalance Int` on User only if perf needs it.)
- Index `(ownerId, createdAt)`.

## Repo (`db/repos/credit-repo.ts` — new)
- `getBalance(ownerId): number` (SUM delta).
- `grantCredits(ownerId, delta, kind, reason, grantedBy?, runId?)` → ledger insert.
- `debit(ownerId, credits, runId, reason)` → negative delta (idempotent per runId — skip if a debit row for that runId already exists).

## Trial grant on signup
- Where users are first created (Google OAuth callback / ensure-user). On CREATE, insert a `trial` ledger entry (e.g. +1000). One-time (guard on kind=trial existing).

## Debit-on-flow
- After a flow run COMPLETES (`runWorkflow` finish / `executePlannedRun`), compute the run's credits (reuse `withCredits`/`creditsFromTokens` over the run's node cost + media USD via `creditsFromUsd`) and `debit(ownerId, credits, runId)`.
- Idempotent by runId (a resumed/re-entered run debits once).
- Chat/brain turns do NOT debit (only flow executor).

## Super-admin bootstrap
- One-off `tsx` script `set-superadmin.ts <email>` → sets `isSuperAdmin=true` (run for auto.agent.solution@gmail.com).

## Files
- Modify: `prisma/schema.prisma`, signup/ensure-user path, `workflow-executor.ts` (or `executePlannedRun`), `cost/credits.ts` (maybe a `creditsForRun` helper).
- Create: `db/repos/credit-repo.ts`, `scripts/set-superadmin.ts`, `prisma/migrations/*`.

## Success criteria
- New tenant has +1000 trial in ledger; `getBalance` = 1000.
- Running a flow debits the right credits once (idempotent on re-run).
- `isSuperAdmin` settable + readable. Chat turns never debit.
- `verify-credit-wallet.ts`: trial grant, grant, debit idempotency, balance math — all green, no real spend.

## Risks
- Debit granularity vs partial runs (see plan open-Q3). Idempotency by runId is the guard.
