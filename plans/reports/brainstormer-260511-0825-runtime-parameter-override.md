---
type: brainstorm-report
date: 2026-05-11
slug: runtime-parameter-override
status: approved
related_plan: TBD (post /ck:plan)
---

# Runtime Parameter Override — Brainstorm Report

## 1. Problem statement

KH chọn agent → muốn tweak vài param (prompt, filter, default categories, max_items, ...) ngay trước khi Run, không phải edit agent permanent. FE cần truyền overrides về BE → BE merge với agent config → đẩy n8n. Mục tiêu: bổ sung trước demo (deadline 2026-05-26).

Baseline hiện tại:
- `AgentInstance.configJson` set lúc tạo agent (wizard) + validate qua `template.configSchemaJson`
- `AgentsService.runAgent()` đẩy `agent.configJson` → n8n payload `config`
- `Execution` row không snapshot config dùng ở lần chạy đó

## 2. Evaluated approaches

### Override scope

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Whitelist subset per template | Safe, controlled, demo-friendly | Cần khai báo thêm metadata | **Chosen** |
| Full configSchemaJson | Linh hoạt nhất | Dễ break workflow nếu đụng field structural | Rejected |
| Free-form JSON editor | Power-user mạnh | "Edit JSON show" = không impressive cho stakeholder | Rejected |

### Persistence

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Snapshot vào Execution row | Audit + replay + lineage | +2 nullable cols | **Chosen** |
| Snapshot + "Save as default" | UX tốt hơn | +1 code path, +UI checkbox state | Deferred |
| Truyền-rồi-quên | Đơn giản nhất | Không trace được "tại sao exec này khác?" | Rejected |

### UI

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Auto-generate từ schema | KISS, scale 5 templates không thêm code | Form generic, không "đẹp polish" | **Chosen** |
| Per-template custom panel | UX đẹp riêng | 5× effort, không scale | Rejected |
| Hybrid auto + 2 polish | Demo wow | Vẫn vượt budget 1-2 ngày | Rejected |

### Trigger UX

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Modal khi bấm Run | Discoverable, không clutter | +1 modal component | **Chosen** |
| Inline panel | Always-visible | Tốn diện tích, confuse với Edit | Rejected |
| Quick + advanced split | Best UX | Phức tạp, 2 button | Rejected |

### Profiles

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Re-run from execution | Zero new model, dùng snapshot có sẵn | Không bind schedule | **Chosen** |
| Full OverrideProfile model | Schedule có thể chọn profile | +1 model, +CRUD UI, +1 ngày | Rejected (vượt budget) |
| Skip profiles | Đơn giản | KH demo khó chịu khi tweak nhiều lần | Rejected |

### Schedule support
- **Manual-only** chosen. Schedule luôn dùng `agent.configJson`. KISS.

## 3. Final solution

### Schema

```prisma
model AgentTemplate {
  // ... existing
  overridableFieldsJson Json @default("[]")  // string[] — whitelist of config keys
}

model Execution {
  // ... existing
  configOverrideJson  Json?  // diff only, null nếu run với defaults
  effectiveConfigJson Json?  // merged final config sent to n8n (snapshot)
}
```

No data migration. Cột nullable. Update 5 seed templates đánh dấu overridable fields.

### Backend

`POST /api/agents/:id/run` body extended:
```json
{ "overrides": { "prompt": "...", "max_items": 100 } }
```

Flow:
1. Load agent + template
2. If `overrides` present:
   - Reject keys ∉ `template.overridableFieldsJson` (400)
   - `effective = { ...agent.configJson, ...overrides }`
   - `validateConfig(effective, template.configSchemaJson)` — existing util
   - Cap `JSON.stringify(overrides).length ≤ 16KB` else 413
3. Create Execution với `configOverrideJson = overrides ?? null`, `effectiveConfigJson = effective`
4. n8n payload `config = effective` — workflow JSON KHÔNG đổi, backward compatible

`AgentsService.runAgent()` thêm arg `overrides?: Record<string, unknown>`.
`ExecutionsService.retry()` pass-through `configOverrideJson` cũ làm overrides mới.

### Frontend

- New `<RunAgentModal>` component:
  - Fetch `template.configSchemaJson + overridableFieldsJson`
  - Render generic form: text/number/textarea/multi-select theo schema type
  - "Default: <value>" hint + "Reset" per field
  - Submit POST `/api/agents/:id/run` với chỉ field đã đổi
- `<ExecutionDetailPage>`:
  - Panel "Configuration applied" diff (default vs override)
  - Button "Run again with these overrides" → mở modal prefilled với `execution.configOverrideJson`
- Default Run button trên agent detail vẫn hoạt động (no-overrides shortcut)

### Whitelist mapping (5 templates)

| Template | Overridable fields |
|---|---|
| gmail-lead-classifier | prompt, categories, max_items |
| email-draft-responder | tone, max_drafts, signature |
| slack-daily-summary | channels, summary_prompt, lookback_hours |
| google-sheet-data-checker | rules, sheet_range |
| ticket-triage-agent | severity_keywords, prompt |

(Final list confirmed lúc implement, dựa configSchemaJson actual)

## 4. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Override JSON bloat DB | 16KB cap, 413 reject |
| Prompt injection nếu prompt là override | Out of scope demo; whitelist = surface control |
| Override sai type → workflow crash | Schema validation trước khi gửi n8n |
| `agent.configJson` đổi giữa lúc modal mở | Show "default at <ts>"; server-side merge tại submit |
| Template schema đổi sau khi exec snapshot | Re-run validate lại với schema CURRENT, không snapshot schema |
| Backward compat n8n workflow | KHÔNG đổi payload contract; `payload.config` vẫn là final merged |

## 5. Success metrics

- 5/5 templates có overridable whitelist hoạt động end-to-end
- Manual run với override → execution snapshot diff hiển thị đúng
- "Re-run from execution" prefill modal đúng và submit thành công
- Schema validation reject invalid override keys/types với 400 + chi tiết
- Demo: 3-execution lineage (default → override A → override B) trong execution history < 60s thao tác

## 6. Implementation considerations

- **File ownership**: BE `agents.service.ts`, `executions.service.ts` + new `validators/overrides.ts`. FE new `<RunAgentModal>`, modify `agent-detail-page.tsx` + `execution-detail-page.tsx`. Prisma migration + seed update.
- **Test coverage**: unit test override validator (whitelist/cap/schema), integration test POST /run with overrides + snapshot, FE smoke modal + re-run flow.
- **No n8n workflow change** → no operator re-import.
- **Time budget**: 1-2 ngày. Phase split: BE (0.5d) → FE (1d) → polish + demo dry-run (0.5d).

## 7. Out of scope (recorded)

- OverrideProfile model + CRUD page
- Schedule binding profiles
- Per-template custom UI (chỉ generic auto-form)
- Git-style diff view (chỉ side-by-side simple)
- Replay = bit-identical (new exec, fresh metrics)
- Override permission per-role (workspace admin = mọi user run được)

## 8. Next steps

1. `/ck:plan` tạo phase doc với checklist + file list
2. Implement theo phase
3. Demo dry-run trước presenter machine
4. Update `DEMO_SCRIPT.md` thêm storyline iterative tuning

## 9. Unresolved questions

- Modal có cần preview "request payload sẽ gửi n8n" cho transparency không? (defer to implementation)
- Có nên audit log mỗi override apply không? (recommend YES — đã có pattern, chi phí thấp)
