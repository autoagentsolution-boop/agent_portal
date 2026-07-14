# Credit Wallet + Super-Admin Grants — Plan

**Date:** 2026-07-14 · **Branch:** `pivot/video-content-farm` · **Status:** PLANNED (decisions locked, not started)

## Goal
Turn "credits" from a **spend display** into a real **balance/wallet** so the super-admin can grant credits (demos / strategic leads) and flow execution is gated when a tenant runs out. Payments deferred.

## Locked decisions
- **Credit math (unchanged):** 1 credit = 250 tokens (`TOKENS_PER_CREDIT`); media 1 credit = $0.000625 (`USD_PER_CREDIT`). Kept as-is — display anchor, no pricing yet.
- **Super-admin only** grants credits (global role). Same person receives Atria's new-node/capability requests (`mkt_roadmap_demand`).
- **Payments deferred** — grants only in v1.
- **Gating:** block FLOW execution at balance ≤ 0; **chat/planning stays free** (brain conversational turns are NOT debited/gated).
- **Balances + grants now, pricing later.**
- **Admin surface:** hidden in-app page at route `/superadminatria101` (super-admin only).
- **New tenant starts with a small free trial balance** (proposed 1,000 credits — confirm).

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | [Balance model + super-admin role + debit-on-flow](phase-01-balance-and-debit.md) | ☐ not started |
| 2 | [Gating (block flow at 0, chat free) + balance in UI](phase-02-gating-and-display.md) | ☐ not started |
| 3 | [Super-admin page `/superadminatria101` (grant + capability requests)](phase-03-superadmin-page.md) | ☐ not started |

## Key integration points (found)
- `User` model (`prisma/schema.prisma`) — has `id/email/accountType/defaultLanguage`, **no role/balance**. Add `isSuperAdmin` + credit balance.
- Credit math single source: `src/cost/credits.ts` (`creditsFromTokens`/`creditsFromUsd`).
- Spend already ledgered: `mkt_llm_usage` (`recordLlmUsage`). Per-run credits via `withCredits` (`orchestration-mappers.ts`).
- Flow execution entry (where to gate + debit): `POST /runs/:id/execute` → `executePlannedRun` (`orchestration-router.ts:141/460`) → `runWorkflow` (`workflow-executor.ts:103`).
- Capability requests already recorded: `mkt_roadmap_demand` via `recordCapabilityGap`, read by `GET /atria/roadmap-demand`.
- Reply-language bug already fixed (User.defaultLanguage default "vi" no longer forces VN — reply pins to the message language).

## Non-goals (v1)
Payments/checkout, per-credit pricing UI, subscriptions, workspace-owner grants, usage-based auto-topup.

## Open questions
1. Trial balance amount — 1,000 credits? (≈250k tokens ≈ a few real flows.)
2. Debit granularity — per-node as it runs, or once per completed run? (Plan: per-run on completion, with a pre-flight estimate for the gate.)
3. Should a flow that runs OUT of credits mid-run finish or halt? (Plan: pre-flight gate blocks start; a run that started is allowed to finish, may go slightly negative.)
4. Super-admin bootstrap — set `isSuperAdmin` on your account via a one-off script/seed? (auto.agent.solution@gmail.com)
