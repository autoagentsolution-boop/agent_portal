# Phase 01 — Locale foundation

## Context Links

- Audit: [`audit-260722-1949-language-localization-gap.md`](../../reports/audit-260722-1949-language-localization-gap.md)
- Content-language rules (do not touch): `src/orchestration/master/detect-language.ts`, `src/copygen/resolve-config.ts`
- Feedback memory: localize user-facing fields, not model input

## Overview

**Priority:** P0 — everything else depends on it · **Status:** ⬜ not started

Establish the one thing the codebase has never had: a place where "what language is this interface in"
is answered, and a way to ask a question of a catalog instead of writing a literal.

## Key Insights

- `web/package.json` today is exactly `react` + `react-dom`. A dependency-free runtime keeps it that way
  and matches this repo's precedent of building its own connector/vault/registry layers.
- **A library was considered and rejected.** `react-i18next` brings ICU plurals, lazy namespaces and a
  React context — but our needs are one plural rule (`{n} post(s)`), one interpolation form, and a
  catalog small enough to ship in the bundle. ~60 lines beats 40 kB and an upgrade treadmill. Revisit only
  if genuinely plural-complex locales (ru, ar) enter the launch set.
- `user.defaultLanguage` is NOT NULL and means content language. Do not overload it. See the plan's
  decision section — conflating the two is the same class of bug this whole track exists to kill.
- Missing key must render **English, never blank and never the key**. A blank button is worse than an
  untranslated one.

## Requirements

**Functional**
- `t(key, params?)` returns the string for the active locale, English on miss.
- Active locale = `user.uiLanguage` → browser `navigator.language` base tag → `en`.
- A user can change `uiLanguage`; it persists and applies without reload.
- Catalogs are plain typed objects keyed by dotted string.

**Non-functional**
- No new runtime dependency; no network fetch for the active catalog on first paint.
- Key lookup is O(1) and must not re-render the tree on unrelated state.
- Type error at build time when a key does not exist in the English catalog.

## Architecture

```
src/i18n/
  catalog.en.ts      source of truth; every key defined here
  catalog.vi.ts      Partial<typeof en>  ← missing keys fall back
  catalog.id.ts      Partial<typeof en>
  catalog.ko.ts      Partial<typeof en>
  index.ts           t(), LocaleProvider, useLocale()
```

`type Key = keyof typeof en` gives compile-time key checking for free — a wrong key is a type error, not
a runtime blank. Interpolation is `{name}` replaced from `params`; no expression syntax, no eval.

Locale resolution runs once in `LocaleProvider` and lives in context. `t` is read through `useLocale()`
so a locale change re-renders subscribers and nothing else.

## Related Code Files

**Create:** `web/src/i18n/index.ts`, `web/src/i18n/catalog.en.ts`, `catalog.vi.ts`, `catalog.id.ts`, `catalog.ko.ts`
**Modify:** `web/src/main.tsx` (wrap in `LocaleProvider`), `web/src/hooks/use-auth.ts` (expose `uiLanguage`), `MKTAgent/prisma/schema.prisma` (`User.uiLanguage String?`), `src/api/auth-router.ts` (return it), `src/api/users-router.ts` or equivalent (PATCH it)
**Delete:** none

## Implementation Steps

1. Prisma: add `uiLanguage String? @map("ui_language")` to `User`. Migration backfills nothing — null
   means "follow the browser", which is the correct behaviour for every existing row.
2. Expose `uiLanguage` on the auth/me payload; add a PATCH endpoint accepting only the launch-set codes.
3. Write `catalog.en.ts` with the ~40 keys phase 03 needs first (auth/credits/connection/approval). Do
   not pre-populate 830 keys — keys arrive with their migration.
4. Write `index.ts`: `LocaleProvider`, `useLocale()`, `t(key, params)`, English fallback, `{param}`
   interpolation, and a dev-only `console.warn` on a miss.
5. Wrap the app; verify a forced `id` locale renders an `id` string and an untranslated key renders EN.
6. Add the language switcher stub to the account menu (visible only when >1 catalog is non-empty).

## Todo List

- [ ] `User.uiLanguage` migration applied and rolled forward on the dev DB
- [ ] `uiLanguage` on the me payload + PATCH endpoint with an allow-list
- [ ] `catalog.en.ts` seeded with the phase-03 key set
- [ ] `t()` + provider + fallback + interpolation
- [ ] Typed `Key` union enforced (wrong key = build error)
- [ ] Switcher renders and persists
- [ ] `verify-i18n-runtime.ts`: miss → English, hit → target, unknown locale → English

## Success Criteria

- Setting `uiLanguage='id'` on a test tenant changes at least one real string end-to-end.
- A deliberately missing key renders the English sentence, never a blank or a dotted key.
- `npx tsc --noEmit` fails when a `t()` call names a key absent from the English catalog.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Hand-rolled runtime grows into a bad i18n library | Cap it: no plural engine, no namespaces, no lazy loading. If any of those become necessary, that IS the signal to adopt `react-i18next`. |
| Locale context re-renders the world | Provider holds `{locale, t}` in a `useMemo`; `t` identity changes only on locale change. |
| `uiLanguage` drifts into content decisions | Never read it in `src/orchestration/**`. Phase 05 adds a verify that greps for exactly that. |

## Security Considerations

- PATCH accepts only codes on the launch allow-list — an arbitrary string would end up in a catalog
  lookup and, worse, in any future filename-based loading.
- Catalog values are React text nodes, never `dangerouslySetInnerHTML`. Interpolated params are escaped by
  React; a lead's name inside a message therefore cannot inject markup.

## Next Steps

Phase 02 can start as soon as the catalog *shape* is fixed (step 3) — it does not need the provider.
Phase 03 needs both.
