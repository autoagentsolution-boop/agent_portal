# Code Review — Phase 01: Array Config Field Type

**Date:** 2026-05-11
**Plan:** `plans/260511-0931-array-config-field-type/phase-01-array-type-implementation.md`
**Scope:** Changed files only (10 files)

## Summary

Implementation matches plan and acceptance criteria 1–4. Symmetric BE/FE validation, idempotent migration with `hasNew`/`hasLegacy` guards, n8n workflow with legacy fallback during transition window. Tests cover the happy paths plus edge cases (empty-array-with-default, mixed-type rejection, min/max/required separation). One UX issue worth a follow-up; the rest are nits or accepted trade-offs.

## CONCERNS

### C1. `inputMode="numeric"` blocks negative/decimal numbers on mobile keyboards
`dynamic-config-form.tsx:238` — `inputMode={itemType === 'number' ? 'numeric' : 'text'}`. On iOS/Android, `inputMode="numeric"` shows a digit-only pad without `-` or `.`. The `add()` parser uses `Number(trimmed)` which *would* accept negatives/decimals if the user could type them, but the keyboard hides the keys.
- **Impact:** No current schema uses number arrays, so latent only. Becomes a real bug the moment someone adds a `min/max ports`, `latitudes`, `discount tiers`, etc.
- **Fix:** Use `inputMode="decimal"` (allows minus + decimal on most platforms) or `"text"` with `pattern` hint.

### C2. Silent string dedup with no user feedback
`dynamic-config-form.tsx:178-181` — when a duplicate is typed, the draft is cleared and the input continues silently.
- **Impact:** UX confusion ("did my input register?"). No error toast or visual cue. Plan call-out flagged this as a question; current behavior is "silent dedup."
- **Fix (low effort):** Briefly flash the existing matching tag (e.g. add ring/scale animation), or surface a transient inline hint "Already added". OK to defer if accepted as demo trade-off — just document.

### C3. `formatValuePreview` truncation absent for long arrays in snapshot panel
`overrides-diff.ts:23` returns `JSON.stringify(v)` with no truncation. `config-applied-panel.tsx` uses `break-all` so long values wrap rather than overflow, but a 10-item array of long Gmail labels (`"Customer Onboarding 2026 Q2 - High Priority"` × 10) becomes a wall of text in the table cell.
- **Impact:** Cosmetic; no bug. Minor concern for the snapshot panel readability during demo.
- **Fix:** Either truncate in `formatValuePreview` (e.g. arrays >3 items → `[a, b, c, …+7]`) or add `max-h-20 overflow-hidden` to the cell. Defer if not seen during smoke.

### C4. `onBlur={add}` can fire after click on the × remove button
`dynamic-config-form.tsx:234` — blur-to-add is convenient but if the user types a draft then immediately clicks an existing tag's `×`, blur fires first. Result: the typed-but-unconfirmed draft gets added *and* the clicked tag gets removed (or vice versa depending on event ordering).
- **Impact:** Minor; not a data corruption risk because `add()` re-validates (trim, dedup, capacity) — worst case is an unintended item committed.
- **Fix:** Suppress blur when relatedTarget is inside the same container, or use `onMouseDown` preventDefault on remove buttons. Optional.

## NITS

### N1. Migration ignores agents with `gmail_labels = []` 
`migrate-gmail-labels.ts:26` — `hasNew = Array.isArray(cfg.gmail_labels) && cfg.gmail_labels.length > 0`. If an agent has both `gmail_label: "Leads"` AND `gmail_labels: []`, the empty array satisfies `Array.isArray` but not `length > 0`, so `hasNew = false`. Code then writes `next.gmail_labels = [cfg.gmail_label]` — correct outcome, but only by luck of the ordering. Fine, just worth a comment.

### N2. Migration doesn't validate item type when seeding from legacy
`migrate-gmail-labels.ts:39` — `[cfg.gmail_label as string]` blindly trusts the legacy value is a string (the `typeof === 'string'` check above guarantees it; the cast is redundant but harmless).

### N3. `key={`${i}-${String(v)}`}` is brittle if dedup is bypassed
`dynamic-config-form.tsx:212` — works because of dedup for strings, but for `itemType=number` there is no dedup, so duplicate keys are possible (e.g., `[80, 80]` produces keys `0-80`, `1-80` — fine, distinct via index). Acceptable.

### N4. Hardcoded `agentInstance` model name in migration
`migrate-gmail-labels.ts:17` — `prisma.agentInstance.findMany({ where: { templateId: 'gmail-lead-classifier' } })`. If model is renamed, migration silently no-ops on rerun. Trivial; idempotent script will be deleted post-transition anyway.

### N5. n8n workflow `gmailLabels[1]` index out-of-bounds protection is awkward
`gmail-lead-classifier.json:34` — `gmailLabels[gmailLabels.length > 1 ? 1 : 0]`. Functional but the ternary is repeated inline. Pulling into a `const secondaryLabel = gmailLabels[1] ?? gmailLabels[0]` would read better. Cosmetic.

### N6. No test asserts `hasValue` change doesn't break existing string/boolean fields
The validator's `hasValue` was extended with `!(Array.isArray && length===0)`. No existing field uses `[]` as a default for non-array types (verified — `seed.ts` defaults are strings/numbers/booleans, demo agent configs use scalars). Safe today, but a regression test pinning current behavior for the four other field types would protect the change.

## OK

- **Acceptance criteria 1** (validator): covered by `config-schema-validator.spec.ts` (10 tests, including empty-when-required, type mismatch, min/max items, default fallback).
- **Acceptance criteria 2** (run modal): `run-agent-modal.tsx` renders via `DynamicConfigForm` — array branch picked up automatically. No modal-specific changes needed; verified by code path inspection.
- **Acceptance criteria 3** (snapshot panel): `formatValuePreview` falls through to `JSON.stringify(v)` for arrays — renders `["Leads","VIP"]`. Works.
- **Acceptance criteria 4** (back-compat):
  - Migration is **idempotent** — `hasNew && !hasLegacy` skips; `!hasNew && !hasLegacy` skips; only legacy-only and legacy+new-empty cases write.
  - n8n fallback chain `gmail_labels → gmail_label → ['Leads']` correct (`gmail-lead-classifier.json:34`).
- **Symmetric validation:** `wizard-validation.ts` mirrors `config-schema-validator.ts` exactly (same `hasValue` expression, same array branch, same error messages). Good.
- **TS build hygiene:** `tsconfig.build.json` correctly excludes `migrate-gmail-labels.ts` so nest build won't pull tsx-only ESM.
- **Demo seed update:** `demo-enrichment.ts:39` switched scalar → array config consistently.
- **Race condition concern (migration vs seed):** Demo flow only; both scripts target same rows but seed uses `upsert` and migration uses `update` — last writer wins. Acceptable for demo. Not a production concern.
- **`overridable` whitelist:** `gmail_labels` correctly added to `overridableFieldsJson` in `seed.ts:50`.
- **Capacity guard + `disabled` styling** on the input + Add button correctly prevents over-add at the UI layer.
- **`Backspace` removes last tag only when draft is empty** — standard tag-input UX, correctly implemented.

## Specific Probes (per request)

| Probe | Verdict |
|---|---|
| `hasValue` change breaks existing fields with `[]` default | **No.** No scalar field uses `[]` as default in current schemas. Change is safe. |
| Silent dedup acceptable UX | **Concern (C2).** Acceptable for demo; flag as follow-up. |
| `inputMode="numeric"` blocks negatives/decimals | **Concern (C1).** Latent — no number-array schema today. |
| Migration race with seed | **OK.** Demo only; last-writer-wins acceptable. |
| `formatValuePreview` truncation | **Concern (C3).** Cosmetic; defer unless smoke shows it. |

## Build & Test

Per task #7, BE build + tests verified by tester subagent. Not re-run here (review-only). Recommend smoke during final manual pass:
- Create new gmail-lead-classifier agent with 2 labels via wizard → save → run.
- Existing post-migration agent runs successfully.
- Override modal: change one label, snapshot panel renders array correctly.

## Recommended Actions (priority)

1. **Defer or fix C1** (inputMode) — one-line change to `"decimal"`. Worth doing now even though latent.
2. **Decide C2** (dedup feedback) — accept for demo, document, OR add a 200ms ring on the duplicate. 5 lines.
3. **Defer C3, C4, all N items** — log in plan's "Out of scope" or follow-up.

## Status

**Status:** DONE_WITH_CONCERNS
**Summary:** Phase 01 implementation matches the plan and satisfies all four acceptance criteria. Symmetric BE/FE validation is correct, migration is idempotent, n8n fallback works. Concerns are UX polish (C1–C4); none block landing.
**Concerns/Blockers:** C1 (numeric inputMode latent bug — trivial fix), C2 (silent dedup — UX call), C3 (long-array truncation — cosmetic), C4 (blur-vs-click race — minor).
