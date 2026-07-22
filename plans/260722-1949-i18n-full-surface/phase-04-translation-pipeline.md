# Phase 04 — Translation pipeline

## Context Links

- [phase 01](phase-01-locale-foundation.md) (catalog shape), [phase 03](phase-03-migrate-act-on-tier.md) (key set)
- Existing LLM plumbing: `src/orchestration/master/llm-json.ts`, cost ledger `src/cost/llm-usage.ts`

## Overview

**Priority:** P1 · **Status:** ⬜ not started

Produce and maintain the non-English catalogs without hand-authoring thousands of strings, while keeping a
human in the loop exactly where a mistranslation costs money.

## Key Insights

- 250 act-on keys × 3 additional launch languages = 750 strings. Hand-translation is a week; a generation
  script is an afternoon. But an LLM mistranslating "Confirm" on a **credit-spend** dialog is a
  money-losing bug, so generation cannot be the whole answer.
- **Split by risk, not by volume:** act-on keys get generated **then reviewed**; chrome keys get generated
  and shipped. That is the same tiering as phase 03, reused.
- This is a **build-time** script, not a runtime feature. Never translate on request — it would put an LLM
  call in the render path and bill per pageview.
- The product already writes marketing copy in 31 languages with this same model; translation quality for
  40-word UI strings is not the risk. Context is: "Confirm" in a delete dialog vs a payment dialog differ
  in several of the target languages. Pass the key name and a usage note, not just the string.

## Requirements

**Functional**
- `npm run i18n:translate -- --locale id` fills missing keys in `catalog.id.ts` from `catalog.en.ts`.
- Only **missing** keys are generated; existing entries are never overwritten (human edits are sacred).
- Act-on keys are emitted into a review queue file until approved.
- A language switcher lets the user pick any locale with a non-empty catalog.

**Non-functional**
- Deterministic output ordering so diffs are reviewable.
- Cost ledgered like every other Gemini call, tagged `surface: 'i18n'`.

## Architecture

```
scripts/i18n-translate.ts
  read catalog.en.ts  →  diff against catalog.<locale>.ts  →  missing keys
  batch ~40 keys per call, with: key name, English text, param names, usage note
  act-on keys      → catalog.<locale>.review.ts   (needs human sign-off)
  chrome keys      → catalog.<locale>.ts          (ship)
```

The usage note comes from a `// @ctx` comment above the key in the English catalog. Keys without a note
still translate; notes exist for the ambiguous ones ("button label on an irreversible delete").

Params must survive: the prompt states the `{param}` tokens explicitly and the script **rejects** any
returned string whose param set differs from the source. That check is worth more than the prompt.

## Related Code Files

**Create:** `MKTAgent/scripts/i18n-translate.ts`, `web/src/i18n/catalog.<locale>.review.ts` (transient),
`web/src/components/language-switcher.tsx`
**Modify:** `web/src/i18n/catalog.{vi,id,ko}.ts` (generated), `package.json` (script entry), account menu

## Implementation Steps

1. Add `// @ctx` notes to ambiguous English keys (money, delete, approve).
2. Write the generation script: diff → batch → call → param-set validation → deterministic write.
3. Generate `vi` first — it is the only language with existing human strings to compare against, so it
   doubles as a quality check on the pipeline itself.
4. Review the act-on queue for `vi` with a native speaker (the user), promote to the main catalog.
5. Generate `id` and `ko`; review their act-on tier the same way.
6. Ship the language switcher.

## Todo List

- [ ] `@ctx` notes on ambiguous keys
- [ ] `i18n-translate.ts` with param-set validation + deterministic output
- [ ] `vi` generated, act-on reviewed against the 17 existing human strings
- [ ] `id`, `ko` generated + act-on reviewed
- [ ] Cost ledgered under `surface: 'i18n'`
- [ ] Language switcher shipped

## Success Criteria

- Regenerating a catalog twice produces a byte-identical file.
- No generated string loses or invents a `{param}`.
- The `vi` act-on tier reads naturally to a native speaker — measured by review, not by the script.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| A mistranslated money/delete label | Act-on tier never ships un-reviewed; review queue is a separate file so it cannot leak by accident. |
| Regeneration clobbers human edits | Script fills only missing keys. Add a `@locked` marker for entries that must never be regenerated. |
| Model drops or renames a `{param}` | Hard validation rejects the batch; the script fails loudly rather than shipping a broken interpolation. |
| Cost surprise | Build-time only, batched, ledgered. Never in the request path. |

## Security Considerations

- Catalog files are code. The script writes escaped string literals only, and must reject any candidate
  containing backticks, `${`, or `</script` — a translated string is data, but it lands in a `.ts` file.
- Never send tenant data to the translator; it sees only English UI strings from the repo.

## Next Steps

Phase 05 asserts catalogs stay complete. Phase 06 (chrome) becomes cheap once this exists — it is the same
script with a bigger key set.
