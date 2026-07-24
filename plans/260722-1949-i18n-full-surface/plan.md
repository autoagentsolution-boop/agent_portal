# i18n across the full surface — frontend + API

**Status:** ✅ **COMPLETE 2026-07-24** (30 UI languages, whole-UI switch, global enforcement, data-driven
registry, RTL). Live-proven KO/FR/AR. Commits `c13c6b6`→`43d861b`, pushed. Handoff:
[`state-260724-1548-i18n-complete-resume-6b.md`](../reports/state-260724-1548-i18n-complete-resume-6b.md).
Deltas from the original plan: locale catalogs are JSON (not `.ts`) with a `locales.ts` single source;
enforcement is GLOBAL (not an opt-in allow-list) with a shrinking `i18n-exempt.json` backlog; the launch
set grew from 4 to all 30 content languages via the pipeline. Owed: a native review of the pipeline-
generated act-on strings (fr onward), and server-side i18n for suggestion content + agent names.

**Original plan below.** · **Branch:** `pivot/video-content-farm`
**Trigger:** [`audit-260722-1949-language-localization-gap.md`](../../reports/audit-260722-1949-language-localization-gap.md) — 7 recurrences of the same defect class; measured cause: ≈830 hardcoded strings, no i18n mechanism, and the two most load-bearing sentences authored **server-side**.

## The decision this plan makes

**UI language ≠ content language.** They are different products of different systems and must never share a
field. `User.defaultLanguage` stays what it is — the language Atria *writes content in*. A new
`User.uiLanguage` governs what the *interface* says. Conflating them is the same mistake in a new place.

**The server stops sending sentences.** Any user-facing text the API produces becomes `{code, params}`.
Only the client turns a code into words. This is the part a frontend-only i18n cannot reach, and it is
where `email_agent: send failed (gmail_not_connected)` and the publish-gate notice come from.

**Not 31 languages on day one.** The picker offers 31 *content* languages because an LLM writes those for
free. UI strings need catalogs. Ship **en, vi, id, ko**; add by demand, not by ambition.

## Phases

| # | Phase | Status | Gist |
|---|---|---|---|
| 01 | [Locale foundation](phase-01-locale-foundation.md) | ✅ | `uiLanguage`, ~60-line `t()`, EN catalog, English fallback, switcher |
| 02 | [API message envelope](phase-02-api-message-envelope.md) | ◑ | `fail()` gains `{params}`; F11 fixed. Full node-error/87-toast sweep folded into 03. |
| 03 | [Migrate the act-on tier](phase-03-migrate-act-on-tier.md) | ✅ | done + extended to the whole chrome tier (26 components) |
| 04 | [Translation pipeline](phase-04-translation-pipeline.md) | ✅ | `npm run i18n:translate`; generated all 29 locales; act-on → `.review.json` |
| 05 | [Enforcement](phase-05-enforcement.md) | ✅ | `verify-i18n` GLOBAL scan; param parity; no-conflation; exempt backlog |
| 06 | [Chrome tier](phase-06-chrome-tier.md) | ◑ | swept except 6 exempt files (App.tsx + 5 forms/modals) |

**Order matters.** 01 → 02 can run in parallel after 01's catalog shape is fixed. 03 depends on both.
05 must land with 03, not after it — the moment the act-on tier is clean is the moment it starts rotting
again. 06 is genuinely optional and should not block a release.

## Key dependencies

- `User.uiLanguage` — Prisma migration (phase 01), nullable, backfilled from `defaultLanguage`.
- No new runtime dependency. `web/package.json` stays `react` + `react-dom` (see phase 01 for why a
  library was rejected).
- Gemini (already wired) for catalog generation in phase 04 — build-time only, never per-request.

## Success criteria for the whole track

1. A user whose `uiLanguage` is `id` sees the connection gate, the credit prompts, the approval buttons
   and every error in Indonesian — including the ones the server produced.
2. `grep` for a new hardcoded user-facing literal fails CI.
3. A server error code with no catalog entry fails CI.
4. Adding a language = adding one catalog file. No code change.

## Explicitly out of scope

- Translating agent-generated **content** (already correct — that is `slots.language`).
- RTL layout for `ar`/`he`. Note it, do not build it; no RTL language is in the launch set.
- Date/number localization (`toLocaleString` already follows the browser). Revisit only if it contradicts
  `uiLanguage` visibly.
