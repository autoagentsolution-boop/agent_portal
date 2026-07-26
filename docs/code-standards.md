# Code Standards

Canonical, enforced conventions for the MKTAgent codebase. This file is the doc-tree pointer the
`documentation-management.md` rule requires; the **authoritative, machine-checked rules** live in
[`../.claude/rules/development-rules.md`](../.claude/rules/development-rules.md). This document records
the conventions that are actually observed in the tree (and where a `verify-*.ts` enforces them), so a
reviewer can tell a real standard from a preference.

## Stack

Express 5 · Prisma 7 (Postgres, Docker on `:5433`) · Zod · Google/Gemini · React 18 + Vite (custom
nav SPA, **no react-router**) · SSE for live status · TypeScript throughout, run via `tsx` (no build
step for the backend). App port `7100`.

## Enforced conventions

| Convention | Rule | Enforced by |
|---|---|---|
| Explicit `.ts` extension in relative imports | Node ESM + `tsx` resolution | `tsc --noEmit` (dangling import fails) |
| Server returns **error CODES, not sentences** — `fail(res, status, 'some_code')` | i18n §; client maps code→words in `t-error.ts` | `verify-i18n.ts` (code coverage tier) |
| User-facing text goes through `t()`, never a string literal | i18n § | `verify-i18n.ts` (literal scan + allow-list) |
| Interface language ≠ content language — never read `User.uiLanguage` inside `src/orchestration/**` | i18n § | `verify-i18n.ts` (no-conflation) |
| Credit display anchor kept in lock-step BE↔FE | no shared module across API/web split | `verify-credits-mirror.ts` |
| FE asset picker matches adapter `supports[]` | per-platform postability | `verify-platform-asset-mirror.ts` |
| Every behavior has a `verify-*.ts` characterization; `npm run verify` is the gate | test-integrity | `run-verify.ts` aggregate |

## File & module conventions

- **Naming**: kebab-case, descriptive-enough that a filename tells an LLM its purpose without opening
  it. Long names are fine.
- **File size**: target < 200 lines; split by concern (the god-file decomposition track exists
  precisely because a few files broke this — see `plans/260725-1600-architecture-map/refactor-plan.md`).
- **No "enhanced" duplicates**: modify the existing file, never fork a `*-v2`/`*-enhanced` copy.
- **Verification scripts**: `verify-*.ts` colocated with the code they exercise; discovered
  automatically by `run-verify.ts`; tiered unit / db / http by a source scan.

## Principles

YAGNI · KISS · DRY. Regex = FACT extraction; LLM = INTENT (do not reopen this boundary when
splitting files). Real implementations only — no mocks/cheats to pass a build.

## See also

- [`../.claude/rules/development-rules.md`](../.claude/rules/development-rules.md) — authoritative rules
- [`product/02-logic-gates-rules-guardrails.md`](product/02-logic-gates-rules-guardrails.md) — runtime guardrails
- [`product/06-technical-debt-and-improvements.md`](product/06-technical-debt-and-improvements.md) — debt inventory
- [`feature-map.md`](feature-map.md) — feature ↔ module relationships (kept current by the ledger hook)
