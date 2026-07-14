# Phase 3 — Super-admin page `/superadminatria101`

**Priority:** P1 · **Status:** ✅ DONE (2026-07-14, uncommitted) — `middleware-superadmin.ts` (`requireSuperAdmin`→**404** for non-admin), `admin-router.ts` (`GET /admin/tenants`, `POST /admin/grant`, `GET /admin/capability-requests`) mounted `requireAuth→requireSuperAdmin`, `SuperAdminPage.tsx` at `/superadminatria101` (URL-detected in App.tsx, not in nav). Grant flips a 0-balance tenant runnable live. Capability backlog = platform-wide `listAllCapabilityRequests`. Verified 9/9. · **Depends on:** Phase 1 (role + repo), Phase 2 (balance read)

## Overview
A hidden, super-admin-only page that does the two super-admin jobs in one place: **grant credits to tenants** and **see Atria's new-node / capability requests** (`mkt_roadmap_demand`).

## Auth
- New middleware `requireSuperAdmin` (checks `User.isSuperAdmin`). All `/admin/*` endpoints behind it. Non-admin → 404 (not 403 — don't reveal the surface).
- Route `/superadminatria101` (obscure URL is defense-in-depth, NOT the auth — the real gate is `requireSuperAdmin`).

## Endpoints (`api/admin-router.ts` — new)
- `GET /admin/tenants` → list users: id, email, balance, trial/granted/spent totals, lastActive.
- `POST /admin/grant` → `{ ownerId, credits, reason }` → `grantCredits(..., kind='grant', grantedBy=admin)`. Returns new balance.
- `GET /admin/capability-requests` → `mkt_roadmap_demand` rows (action='requested'): agent_id, exampleTask, count, first/last seen. (Reuse `listDemand` / `GET /atria/roadmap-demand` logic.)
- (Optional) `POST /admin/capability-requests/:id/ack` → mark reviewed.

## UI (`web/.../SuperAdminPage.tsx` — new, routed at `/superadminatria101`)
- Guarded client-side by `GET /auth/me` → isSuperAdmin (server is the real gate).
- **Tenants table:** email · balance · [Grant credits] (amount + reason → POST /admin/grant).
- **Requested capabilities:** list from `/admin/capability-requests` — what users asked Atria for that doesn't exist yet (the demand backlog). This is where you decide what node to build next.

## Files
- Create: `api/admin-router.ts`, `api/middleware/require-superadmin.ts`, `web/.../SuperAdminPage.tsx`, route registration.
- Modify: server route mounting, web router.

## Success criteria
- Non-admin hitting `/admin/*` or `/superadminatria101` → 404 / redirect, no data leak.
- Super-admin: sees all tenants + balances; grants credits → tenant balance rises immediately; sees the capability-request backlog (incl. the `transcribe-audio` row already logged).
- `verify-admin.ts`: requireSuperAdmin blocks non-admin; grant updates balance; capability list returns rows.

## Risks
- Keep it OFF the normal nav (only reachable by URL). Ensure the middleware, not the URL, is the security boundary.
