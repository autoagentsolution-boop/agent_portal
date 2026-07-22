# Phase 05 — Enforcement

## Context Links

- The lesson this phase exists for: [`audit-260722-1949-language-localization-gap.md`](../../reports/audit-260722-1949-language-localization-gap.md) — "a rule recorded in memory governs nothing"
- Precedent: `verify-video-script.ts` asserts contract text; `verify-nurture-email-from-chat.ts` now asserts the counterparty-language contract (5 checks, added 2026-07-22)

## Overview

**Priority:** P0 — **lands with phase 03, not after it** · **Status:** ⬜ not started

This is the phase that makes "global" true. Everything else is a one-time cleanup; without this, the eighth
recurrence is already scheduled.

## Key Insights

- The defect class survived **7 fixes** across ~6 weeks. Every fix was correct and none of them held,
  because nothing failed when the next path forgot.
- Three invariants cover the whole surface, and all three are cheap greps/parses — no framework needed:
  **(a)** no new hardcoded user-facing literal in the act-on tier, **(b)** every server-emitted code has a
  catalog entry, **(c)** every catalog key is reachable (no orphans).
- A fourth guards the conflation that started this: `uiLanguage` must never be read inside
  `src/orchestration/**`, and `slots.language` must never be read to decide UI chrome.
- Run in the existing `npm run verify` runner (unit tier) — it is already the project's gate and needs no
  new CI concept.

## Requirements

**Functional**
- CI fails on a new literal in a file marked as migrated.
- CI fails on a thrown/emitted code with no `err.*`/`notice.*` catalog entry.
- CI fails on a catalog key nothing references (prevents dead weight and typo-keys).
- CI fails if a non-English catalog has a key whose `{param}` set differs from English.

**Non-functional**
- Whole check runs in seconds; no network, no LLM.
- Opt-in per file via an allow-list, so phase 03 can migrate screen groups incrementally without the gate
  blocking un-migrated files.

## Architecture

```
src/scripts/verify-i18n.ts        (unit tier)
  1. literal scan   — for each file in i18n-migrated.json: no bare JSX text, no quoted
                      multi-word string in notify()/confirm()/prompt()/title=/aria-label=
  2. code coverage  — grep thrown codes + fail() codes + notice codes in src/**  ⊆  err.*/notice.* keys
  3. orphan keys    — every catalog key appears in a t()/tError() call somewhere in web/src
  4. param parity   — catalog.<locale>[k] params  ===  catalog.en[k] params
  5. no conflation  — 'uiLanguage' absent from src/orchestration/**
```

`i18n-migrated.json` is the allow-list. A file enters it when its screen group is migrated; from that
moment the file can never regress. This is what makes incremental migration safe.

## Related Code Files

**Create:** `src/scripts/verify-i18n.ts`, `web/src/i18n/i18n-migrated.json`
**Modify:** `src/scripts/run-verify.ts` (register in the unit tier), `docs/code-standards.md` (state the
rule + point at the verify), `.claude/rules/development-rules.md` (one line: user-facing text goes through
`t()`, server sends codes)

## Implementation Steps

1. Write the literal scanner. Tune it against an already-migrated file until zero false positives — a
   noisy gate gets disabled, which is worse than no gate.
2. Write code-coverage + orphan checks by parsing the English catalog's keys and grepping call sites.
3. Write param-parity across locales.
4. Add the conflation grep.
5. Register in the unit tier; seed `i18n-migrated.json` with whatever phase 03 has finished.
6. Document the rule in `docs/code-standards.md` **and** in the repo development rules, with a pointer to
   the verify — so the next contributor meets the gate before the review, not after.

## Todo List

- [ ] Literal scanner with zero false positives on a migrated file
- [ ] Code-coverage check (server codes ⊆ catalog)
- [ ] Orphan-key check
- [ ] Param-parity check across locales
- [ ] `uiLanguage` conflation grep
- [ ] Registered in `npm run verify` unit tier
- [ ] `docs/code-standards.md` + development rules updated

## Success Criteria

- Deliberately adding `notify('Something went wrong')` to a migrated file fails `npm run verify`.
- Deliberately throwing a new code without a catalog entry fails.
- Deleting a catalog key that is still used fails.
- The whole i18n verify runs in under ~5s.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| False positives make the team disable the gate | Allow-list is opt-in per file; tune the scanner before adding files; permit an explicit `/* i18n-ignore: reason */` for genuine cases (log strings, test fixtures). |
| The gate is added but the allow-list stays empty | Phase 03's definition of done for each screen group INCLUDES adding its files to the list. Not a separate task. |
| Orphan check fights dynamic keys | Ban dynamic key construction outright — `t('a.' + x)` is the pattern that defeats every static analysis. The scanner flags it. |

## Security Considerations

- The literal scanner must not read `.env` or any gitignored file; scope it to `web/src` and `src`.

## Next Steps

Once green, the class is closed. Phase 06 (chrome) can then proceed at leisure — the gate keeps it from
sliding back.
