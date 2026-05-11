---
slug: array-config-field-type
created: 2026-05-11
status: pending
branch: main
budget: 2-3 hours
related_brainstorm: plans/reports/brainstormer-260511-0825-runtime-parameter-override.md
parent_plan: plans/260511-0825-runtime-parameter-override
blockedBy: []
blocks: []
---

# Array Config Field Type — Implementation Plan

## Goal

Add `array` type to the config schema system so templates can declare list-valued fields (vd: `gmail_labels: string[]`). Required for multi-label classifiers, multi-channel notifiers, multi-rule checkers. Demo storyline mở rộng: KH override list values per run.

## Source

- Brainstorm parent: `plans/reports/brainstormer-260511-0825-runtime-parameter-override.md`
- Discussion 2026-05-11: KH hỏi multi-label cho gmail-lead-classifier — hiện schema chỉ string, không support list
- Existing precedent: `google-sheet-data-checker.required_columns` dùng comma-separated string (workaround, không clean)

## Current state

- `FieldSchema.type` union: `'string' | 'number' | 'boolean' | 'select' | 'textarea'`
- `validateConfig` chỉ check primitive types
- `DynamicConfigForm` render input/select/checkbox/textarea — không có array UI
- `gmail-lead-classifier.gmail_label` = single string, NOT overridable
- `google-sheet-data-checker.required_columns` = comma-separated string (legacy workaround)

## Desired state

- `FieldSchema.type` thêm `'array'` với `itemType: 'string' | 'number'`, optional `minItems`/`maxItems`
- `validateConfig` accept arrays, validate each item theo `itemType`, enforce length bounds
- `DynamicConfigForm` render tag-input UI cho array (add/remove items)
- `gmail-lead-classifier.gmail_label` (string) → `gmail_labels` (array<string>), thêm vào overridable
- n8n workflow update để đọc array, build OR-query
- Existing agent instances backfilled: `configJson.gmail_label = 'X'` → `configJson.gmail_labels = ['X']`

## Phases

| # | Name | Status | Effort |
|---|------|--------|--------|
| [01](phase-01-array-type-implementation.md) | Schema + validator + form + seed migration + n8n workflow | pending | 2-3h |

## Critical decisions (locked)

- **Type name:** `array` (singular) với `itemType` discriminator. Avoid `'string-array' \| 'number-array'` (combinatorial bloat).
- **Backward compat:** Migration script convert `gmail_label` string → `gmail_labels` array trong existing `AgentInstance.configJson` rows. NOT keep both fields.
- **UI pattern:** Tag input — comma/Enter to add, X to remove. Không dùng raw textarea (lỗi format dễ).
- **Validator strictness:** Reject mixed-type array (vd `['a', 1]`), reject length 0 nếu required.
- **n8n workflow:** Update gmail-lead-classifier.json to consume `config.gmail_labels` array — workflow refinement nằm trong scope phase này.

## Out of scope

- `array<object>` hoặc nested arrays (chỉ primitive items)
- Multi-select UI từ predefined enum (dùng existing `enum` field cho select đơn; multi-select khác phase)
- Other templates' multi-value migration (chỉ gmail-lead-classifier — proves pattern)
- Custom item validators per item (phase sau nếu cần)

## Backward compat strategy

1. **Schema migration**: NOT needed — `configJson` is `Json` column, accepts arrays already
2. **Data migration**: One-shot script `backend/prisma/migrate-gmail-labels.ts` chạy 1 lần:
   ```
   For each AgentInstance where templateId='gmail-lead-classifier' and configJson.gmail_label exists:
     configJson.gmail_labels = [configJson.gmail_label]
     delete configJson.gmail_label
   ```
3. **Seed update**: change template's `configSchemaJson` để `gmail_labels` thay `gmail_label`
4. **n8n workflow**: workflow JSON edit tay (or via n8n UI export); document in plan
5. **Frontend wizard**: Step 4 (Configuration) tự động render tag input vì dùng `DynamicConfigForm`

## Risks

| Risk | Mitigation |
|---|---|
| Existing executions retain old `config.gmail_label` in payload history | Audit log only — không impact runtime; new executions dùng new schema |
| n8n workflow breaks during deploy nếu order migrate sai | Order: (1) update schema validator + form (deploy BE+FE), (2) backfill data, (3) update workflow, (4) update seed (re-seed) |
| Tag input with empty array on submit | Validator reject nếu required + length 0; UI hint "Add at least 1 label" |
| Override modal shows wrong UI nếu schema không kịp deploy | FE+BE deploy cùng lúc; pre-existing single-string runs chuyển sang array trước |

## Success criteria

1. Schema validator accept `{ gmail_labels: ['Leads', 'VIP'] }` cho gmail-lead-classifier template
2. Reject `{ gmail_labels: [1, 2] }` (wrong itemType) với 400 + field error
3. Reject `{ gmail_labels: [] }` if required với 400
4. Wizard Step 4 render tag input cho field type `array`, add/remove works
5. Run modal cho gmail-lead-classifier expose `gmail_labels` (vì added to overridable), tag input render correctly
6. Override `{ gmail_labels: ['VIP'] }` → execution snapshot lưu đúng, n8n workflow nhận array
7. Existing agent instances vẫn run được sau migration (no broken validation)
8. n8n workflow query/filter Gmail labels theo array (OR logic)

## Pending operator actions (post-implement)

- Stop docker stack
- Apply data migration script
- Re-seed templates
- Re-import gmail-lead-classifier workflow vào n8n (or edit live qua UI)
- Smoke test cold-start

## Demo storyline addition

Update `DEMO_SCRIPT.md` Act 4b:
- Add 2nd label "VIP" via tag input → re-run → expanded result set
- Show "this run filtered Inbound + VIP" in Configuration applied panel (array stringified `["Inbound","VIP"]`)
