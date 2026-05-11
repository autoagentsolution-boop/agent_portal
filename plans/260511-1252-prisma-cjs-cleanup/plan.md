# Prisma Client CJS Cleanup

**Created:** 2026-05-11
**Status:** pending
**Branch:** main
**Priority:** Low (post-demo cleanup)

## Goal

Eliminate the manual patch on `backend/src/generated/prisma/client.ts` that swaps `import.meta.url` for a `__filename`-based shim. The patch is fragile — any `npx prisma generate` overwrites it and re-introduces a startup crash on clean Docker rebuilds.

## Background

Prisma 7's default `prisma-client` generator emits ESM-first code that uses `import.meta.url` at module scope. The backend's `package.json` has `"type": "commonjs"` and `tsconfig` emits CommonJS — Node's CJS loader rejects `import.meta` at parse time. Symptom: `SyntaxError: Cannot use 'import.meta' outside a module` during backend startup.

Current mitigation: line 16 of the generated `client.ts` is hand-edited to use `__filename` and the file carries `@ts-nocheck`. Survives unless `prisma generate` runs.

## Out of scope

- Switching the Prisma engine (still PgPool driver adapter)
- Migrating to ESM project-wide (much larger blast radius — NestJS CJS dependencies, jest config, etc.)
- Touching the migration history

## Phases

| # | Name | Status |
|---|------|--------|
| 01 | Evaluate generator switch + apply OR codify auto-patch | pending |

See `phase-01-prisma-generator-fix.md`.

## Key decisions to make in Phase 01

- **Path A — switch generator** to `prisma-client-js` (legacy CJS-friendly). Risk: import path changes across `backend/src/prisma`, possible breaking change in driver adapter wiring. Pros: permanent, no patch.
- **Path B — postinstall patch script** that re-applies the `__filename` shim after every `prisma generate`. Risk: silent failure if Prisma changes the emitted line. Pros: no engine swap, low blast radius.
- **Path C — accept the manual patch** but add a CI guard that fails build if `client.ts` regenerates without the shim. Risk: relies on team discipline.

Recommend evaluating A first (single afternoon spike to test); fall back to B if A breaks the driver adapter wiring.

## Success criteria

- `npx prisma generate` followed by `docker compose up -d --build backend` results in a backend container that starts without `SyntaxError: Cannot use 'import.meta' outside a module`.
- No manual edit step required between `prisma generate` and a successful build.
- Existing 16/16 backend tests stay green.
