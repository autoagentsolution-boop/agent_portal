# Session Summary — Array Type Phase + Runtime Debug Fixes

**Date:** 2026-05-11 | **Branch:** main | **Local commit:** `c3bd626` (push pending) + uncommitted patches below

## Scope

1. Ship Phase 01 of `plans/260511-0931-array-config-field-type/`
2. Debug "Run Now no modal" report → uncovered 3 separate operational bugs
3. Document everything for user review

---

## 1. Phase 01 Shipped (commit `c3bd626`, push pending)

| Surface | Change |
|---|---|
| BE validator | `FieldSchema.type` += `'array'` with `itemType`, `minItems`, `maxItems`. `validateConfig` array branch. `hasValue` treats `[]` as no-value (affects all field types — reviewer-verified safe) |
| BE tests | `config-schema-validator.spec.ts` NEW — 10 cases (16/16 BE suite green) |
| FE | `FieldSchema` extended; `ArrayInput` tag-input renderer in `dynamic-config-form.tsx` (Enter/comma to add, Backspace to remove last, capacity guard, decimal `inputMode` for numbers); symmetric `wizard-validation.ts` |
| Migration | `backend/prisma/migrate-gmail-labels.ts` (idempotent) + `npm run migrate:gmail-labels` |
| Seed | `gmail-lead-classifier`: `gmail_label` → `gmail_labels` array (default `['Leads']`, min 1 max 10). Added to overridable. `demo-enrichment.ts` updated |
| n8n | `gmail-lead-classifier.json` reads `config.gmail_labels` with legacy fallback; surfaces label set in summary + `result.data.gmail_query` |
| Demo | `DEMO_SCRIPT.md` Act 4b updated for tag-input flow |
| Plan | Status: `pending` → `completed` |

Reports:
- `plans/reports/code-reviewer-260511-0957-array-config-field-type.md` — DONE_WITH_CONCERNS, no blockers
- `docs/journals/2026-05-11-array-config-field-type.md`

---

## 2. Bugs Found During User Testing

### 2A. UX: Two "Run Now" buttons, different behavior

| Location | onClick |
|---|---|
| `agent-card.tsx:24` (list page) | `runMutation.mutate(agentId)` — runs immediately, **no modal** |
| `agent-detail-page.tsx:137` | `setRunModalOpen(true)` — opens override modal ✓ |

**Impact:** User clicked Run Now on agent CARD → bypassed override → couldn't change threshold. Demo flow broken.

**Status:** NOT FIXED yet. User needs to choose:
- **Option A** (recommended, 5 min): Card Run Now → navigate to detail page with `?run=1` query param → auto-open modal
- **Option B** (30 min): List endpoint returns full template; modal mounts on list page
- **Option C** (2 min): Remove Run Now from card entirely

### 2B. UX: Configuration tab is read-only but looks editable

`agent-detail-page.tsx:213-215` Configuration tab footer:
> *"Editing config inline ships in a later phase."*

User reads "Configuration" tab → expects edit → finds none → frustrated. Detail page Run Now (top-right) is the actual override entry but not discoverable from the Configuration context.

**Status:** NOT FIXED yet. Suggested footer rewrite proposed but not applied (user did not commit to UX fix scope).

### 2C. OPS: Docker containers not bind-mounted, stale source

`docker-compose.yml`: `frontend` and `backend` services have NO `volumes:` mount. `Dockerfile` uses `COPY . .` then bakes source into image. Result: code edits invisible to running containers until `docker compose up -d --build`.

**Impact:** User's frontend container was built at session start (~3h before override modal shipped) → still running pre-Phase-15 bundle → Run Now button used old direct-mutate code path. Same for backend stale dist.

**Fix applied:** README new section **"Updating Code (IMPORTANT)"** + 3 troubleshooting rows. Memory entry: `~/.claude/projects/.../memory/project_docker_no_bindmount.md`. Future debugging hits this hypothesis FIRST.

### 2D. CRIT: Backend Prisma client `import.meta.url` time-bomb

After `docker compose down && up --build`, backend crash-looped:

```
SyntaxError: Cannot use 'import.meta' outside a module
  at /app/dist/generated/prisma/client.js:42
```

Root cause: Prisma 7 `prisma-client` (new ESM-first generator) emits `import.meta.url` shim. `package.json type=commonjs` + tsc `module=nodenext` → tsc compiles to CJS but preserves `import.meta` literal. Node CJS loader rejects at parse time.

**Why it worked before:** previous container had cached `dist/` from an earlier build (likely under a different Prisma version or dependency state). Crash only manifests on clean rebuild.

**Fix applied:** Edited `backend/src/generated/prisma/client.ts` line 16 directly:
```ts
// before:
globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))
// after:
declare const __filename: string;
globalThis['__dirname'] = path.dirname(__filename);
```
File has `// @ts-nocheck` already; fix survives unless someone runs `npx prisma generate` (will overwrite — patch must be reapplied). Inline comment added warning.

**Status:** Patched + verified backend boots. NOT a permanent fix — see §5 below.

---

## 3. Current Runtime State (verified)

```
docker compose ps:  4 services Up
curl localhost:4000/api/health → {"status":"ok"}
DB:
  - AgentTemplate gmail-lead-classifier overridable = ["gmail_labels","lead_score_threshold","notify_slack"]
  - 4 agent instances migrated (gmail_label → gmail_labels)
  - 1 instance skipped (cmow9v448001301mwv5gestaw — no legacy field; will fail Run Now until user adds label via modal)
```

---

## 4. User Test Checklist

After hard-refresh browser (Ctrl+Shift+R):

- [ ] Navigate **Agents → Sales Lead Pipeline** (detail page)
- [ ] Click **Run Now** (top-right button) → modal opens
- [ ] Modal shows 3 fields: `gmail_labels` (tag input pre-filled `Inbound Leads`), `lead_score_threshold` (70), `notify_slack` (off)
- [ ] Add tag "VIP" via tag input — pill appears
- [ ] Bump threshold 70 → 85
- [ ] Click Run Now in modal → execution detail page opens
- [ ] **Configuration applied** panel shows diff: gmail_labels `["Inbound Leads"]` → `["Inbound Leads","VIP"]`, threshold `70` → `85`
- [ ] Wizard create-agent flow: Step 4 renders tag input for `gmail_labels` (test with new agent)
- [ ] Verify CARD Run Now (list page) — confirm it does NOT open modal (known bug 2A)

---

## 5. Permanent Fixes Needed (post-demo)

| # | Issue | Recommended fix | Effort |
|---|---|---|---|
| 1 | Run Now card vs detail inconsistency | Option A — card navigates to detail with `?run=1` auto-open | 5 min |
| 2 | Configuration tab misleading footer | Update copy + add "Run with overrides" CTA pointing to header button | 5 min |
| 3 | Prisma `import.meta` time-bomb | Switch `schema.prisma` to `provider = "prisma-client-js"` (legacy CJS) OR add `prisma generate` postscript that auto-patches | 15 min + smoke |
| 4 | Phase 16 commit not pushed (push-to-main blocked by harness classifier) | User pushes manually: `git push origin main` | 10 sec |

---

## 6. Files Modified This Session (uncommitted)

```
README.md                                    (added "Updating Code" section + 3 troubleshooting rows)
backend/src/generated/prisma/client.ts       (CJS patch — line 16)
```

---

## 7. Pending Operator Actions on Production-Like Environments

(For any presenter machine cloning fresh)

```bash
docker compose up -d --build              # full rebuild required
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
docker compose exec backend npm run prisma:demo-seed
docker compose exec backend npm run migrate:gmail-labels
# then import n8n workflows per docs/n8n-workflow-setup.md
```

---

## Unresolved Questions

1. UX bug 2A (card vs detail Run Now) — ship Option A now, or defer to post-demo?
2. Configuration tab UX (2B) — fix copy now, or accept as known limitation for demo?
3. Prisma generator switch (5/#3) — switch to `prisma-client-js` (riskier, may need import path changes) or keep patched generated file (fragile if anyone regenerates)?
4. Should commit `c3bd626` be pushed before or after fixing 2A/2B (so push includes UX fixes too)?
