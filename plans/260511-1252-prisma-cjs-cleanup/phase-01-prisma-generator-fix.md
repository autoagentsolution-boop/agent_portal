# Phase 01 — Prisma Generator Fix

**Status:** pending
**Priority:** Low (post-demo)
**Estimated effort:** 2–4 hours (incl. validation)

## Context Links

- Root-cause analysis: `docs/journals/2026-05-11-outcome-extractor-hotfix.md` § "Non-Obvious Decisions"
- Earlier debug notes: `plans/reports/session-summary-260511-1229-array-type-and-runtime-fixes.md` § 2D
- Patched file (current mitigation): `backend/src/generated/prisma/client.ts:16` — uses `__filename` + `declare const __filename: string` + `@ts-nocheck`
- Affected import sites: every NestJS provider that does `import { PrismaClient } from './generated/prisma/client'`

## Overview

Generated Prisma client emits `import.meta.url` at module scope. Backend compiles to CommonJS → Node parse error at startup. Manual patch survives only until next `prisma generate`.

## Key Insights

- The crash is **parse-time**, not runtime. Cannot be caught by try/catch or feature-flagged at runtime.
- The patched file already has `@ts-nocheck`, so adding `declare const __filename: string` does not require widening any tsconfig.
- `npx prisma generate` is invoked manually today (no postinstall hook, no Dockerfile step). Frequency: low. But any contributor or CI step that runs it without knowing about the patch breaks the build.
- Prisma 7 ships two generators: `prisma-client` (new, ESM-first) and `prisma-client-js` (legacy, CJS-friendly). Schema currently uses `prisma-client`.

## Requirements

### Functional

- Clean rebuild (`docker compose down && up -d --build`) must produce a backend container that starts successfully without manual intervention.
- `prisma generate` followed by `npm run build` must not require any post-generate file edits.
- All existing Prisma queries (findMany, transaction, raw query) keep their current call signatures — no caller-side refactor in scope.

### Non-functional

- Driver adapter (`@prisma/adapter-pg`) must still wire up. We use the PgPool adapter — confirm `prisma-client-js` supports it the same way.
- 16/16 backend tests stay green.
- No new runtime dependencies.

## Architecture — Three Paths

### Path A — Switch generator (preferred if it works)

Edit `backend/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}
```

Delete current `backend/src/generated/prisma/` directory entirely. Re-run `npx prisma generate`. New output lands in `node_modules/.prisma/client` by default (legacy convention) — update imports across `backend/src/prisma/*.ts` to `import { PrismaClient } from '@prisma/client'`.

**Validation steps:**
1. `npx prisma generate`
2. `npm run build` — verify no compile errors
3. `npm test` — 16/16 must pass
4. `docker compose up -d --build backend` — verify container starts
5. Hit `/api/health` + one DB-backed endpoint (e.g. `/api/agents`)
6. Confirm driver adapter still active (log `client._engineConfig.adapter` or check first query plan)

**Risk:** unknown breaking changes between `prisma-client` and `prisma-client-js` API surfaces in Prisma 7. Mitigation: timebox to 2 hours; if blocked, fall back to Path B.

### Path B — Postinstall auto-patch

Keep generator as-is. Add `backend/scripts/patch-prisma-client.mjs` that runs after `prisma generate`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/generated/prisma/client.ts';
const src = readFileSync(path, 'utf8');
const patched = src.replace(
  /globalThis\['__dirname'\] = path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/,
  "declare const __filename: string;\nglobalThis['__dirname'] = path.dirname(__filename);"
);
if (src === patched) {
  console.error('[patch-prisma-client] no replacement made — generator may have changed');
  process.exit(1);
}
writeFileSync(path, patched);
console.log('[patch-prisma-client] applied');
```

Wire into `package.json`:
```json
{
  "scripts": {
    "prisma:generate": "prisma generate && node scripts/patch-prisma-client.mjs"
  }
}
```

Plus add a Dockerfile step (RUN npm run prisma:generate before build) so clean rebuilds get the patched output.

**Risk:** if Prisma changes the emitted line in a minor version bump, the regex fails and CI breaks loudly (intentional — script exits non-zero).

### Path C — CI guard only

Accept manual patch but add a check in CI:
```bash
grep -q "declare const __filename" backend/src/generated/prisma/client.ts || \
  { echo "Prisma client unpatched — run scripts/patch-prisma-client.mjs"; exit 1; }
```

**Risk:** relies on humans running the patch script. Not recommended as standalone fix.

## Related Code Files

**Likely modified (Path A):**
- `backend/prisma/schema.prisma`
- `backend/src/prisma/prisma.service.ts` (re-point import to `@prisma/client`)
- `backend/src/prisma/prisma.module.ts` (same)
- Possibly every file under `backend/src/modules/**` that imports `PrismaClient` types

**Likely modified (Path B):**
- `backend/scripts/patch-prisma-client.mjs` (new)
- `backend/package.json` (script entry)
- `backend/Dockerfile` (add prisma:generate step)

**Deleted (Path A):**
- `backend/src/generated/prisma/` (entire directory)

## Implementation Steps

1. Pick Path A first; timebox spike to 2 hours.
2. Spike branch: `chore/prisma-generator-eval`. Apply schema change + delete generated dir + regenerate.
3. Audit grep `import.*generated/prisma/client` in `backend/src/**` and replace with `@prisma/client`.
4. Run `npm run build` + `npm test`. Capture any errors.
5. If build red AND root cause is non-trivial (e.g. driver adapter API gap), abandon Path A → switch to Path B.
6. Path B: write the patch script, wire `package.json`, update Dockerfile, verify clean rebuild.
7. Either path: remove the inline patch + warning comment from current `client.ts` once the new approach is in.

## Todo List

- [ ] Path A spike: schema change + regenerate + import audit
- [ ] Path A validation: build + tests + Docker rebuild + endpoint smoke
- [ ] If Path A fails: implement Path B script + Dockerfile + package.json wiring
- [ ] Either path: remove manual patch + comment from `client.ts`
- [ ] Run `docker compose down && up -d --build backend` from clean state — confirm no manual step needed
- [ ] Update `docs/journals/` with outcome + which path chosen

## Success Criteria

- Clean rebuild from `docker compose down -v && up -d --build` lands on a healthy backend container with no manual intervention
- `npx prisma generate` is idempotent w.r.t. build success
- 16/16 backend tests pass

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Path A breaks driver adapter wiring | Medium | Timebox 2h; fall back to Path B |
| Path B regex fails on Prisma minor upgrade | Low | Script exits non-zero with clear error → caught by CI |
| Import path migration touches 30+ files | Medium | Codemod with sed/jscodeshift; commit per layer |
| Dockerfile changes affect cold-start time | Low | `prisma generate` adds ~5–10s; acceptable |

## Security Considerations

None directly — Prisma client is a build artifact. The patch script reads/writes only inside `backend/src/generated/`. No new network calls, no new permissions.

## Next Steps

- Post-demo (after 2026-05-26): start Path A spike on a feature branch
- If chosen path lands: close this plan, archive `docs/journals/2026-05-11-outcome-extractor-hotfix.md` § Prisma section as "resolved by `260511-1252-prisma-cjs-cleanup`"
