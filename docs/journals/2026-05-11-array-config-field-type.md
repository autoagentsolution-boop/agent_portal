# Array Config Field Type Implementation

**Date**: 2026-05-11 14:32
**Severity**: Medium
**Component**: Config schema validation (BE), DynamicConfigForm (FE), n8n workflow integration
**Status**: Complete — awaiting manual push to main

## What Shipped

Backend: array type validator + 10 passing unit tests in `config-schema-validator.ts`. Frontend: FieldSchema union type + tag-input renderer in DynamicConfigForm with symmetric client-side validation. Migration script for gmail-lead-classifier (string `gmail_label` → array `gmail_labels`, idempotent). n8n workflow updated to consume array with legacy fallback; surfaces label set in summary and audit query. DEMO_SCRIPT.md Act 4b updated. Commit `c3bd626` created locally.

## Non-Obvious Decisions

**`hasValue` semantic change**: Empty array `[]` now treated as "no value" in validator — applies to ALL field types, not array-specific. Affects fallback semantics when array+default is used. Code reviewer confirmed safe (no existing scalar field uses `[]` as default).

**Dual validator maintenance burden**: BE `config-schema-validator.ts` and FE `wizard-validation.ts` must stay symmetric. No shared code. Reviewer flagged as duplication risk for future field-type additions — worth documenting if we add more types.

## Blockers & Quirks

Auto-mode security classifier gates push-to-main even after explicit AskUserQuestion approval. User must push manually or grant harness permission. Not a code issue — infrastructure pattern.

One UX nit (numeric→decimal inputMode) applied post-review.

## Next Steps

- User manually pushes commit `c3bd626` to main (harness won't allow automated push)
- Consider refactor story for validator duplication if field types continue to grow
- Monitor n8n workflow for gmail-labels migration in production
