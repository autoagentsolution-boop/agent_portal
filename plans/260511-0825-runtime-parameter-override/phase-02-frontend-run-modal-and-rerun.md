# Phase 02 — Frontend RunAgentModal + Re-Run Flow

**Status:** pending | **Effort:** 1d | **Owner:** FE | **Depends on:** Phase 01

## Context Links

- Brainstorm report: `plans/reports/brainstormer-260511-0825-runtime-parameter-override.md`
- Backend contract: `phase-01-backend-override-pipeline.md` §Implementation
- Existing pages: `frontend/src/pages/agent-detail-page.tsx`, `frontend/src/pages/execution-detail-page.tsx` (verify exact paths during impl)
- Loading + error primitives: `frontend/src/components/ui/{loading-skeleton,empty-state,error-state}.tsx`

## Overview

Build `<RunAgentModal>` that fetches template schema + overridable whitelist, auto-renders generic form, submits to extended `/api/agents/:id/run`. Wire modal into agent detail Run button. Add "Configuration applied" panel + "Run again with these overrides" button on execution detail.

## Key insights

- Schema-driven form = 1 generic component, no per-template code
- Submit only modified fields (diff vs defaults) → smaller payload, clearer audit
- Re-run = same modal prefilled with `execution.configOverrideJson` → zero new component
- Use existing `<ErrorState>` + skeleton primitives — no new loading patterns

## Requirements

### Functional
- Click Run on agent detail → modal opens, fields prefilled with `agent.configJson` (only overridable subset visible)
- Each field shows "Default: <value>" hint + per-field "Reset" button
- Submit → POST `/api/agents/:id/run` with body `{ overrides: <only modified fields> }`
- Empty diff → submit `{}` (no overrides, no snapshot)
- Validation errors from BE → display inline per field
- Execution detail page shows "Configuration applied" panel iff `configOverrideJson != null`
- Panel shows side-by-side: Default value | Override value (per modified key)
- "Run again with these overrides" button → opens modal prefilled with `configOverrideJson`

### Non-functional
- Modal closes only after successful POST (not on submit click)
- Loading spinner on submit button while in-flight
- Modal accessible (esc to close, focus trap) — use shadcn Dialog primitive

## Architecture

```
<AgentDetailPage>
  └─ <Button onClick={openRunModal}>Run</Button>
  └─ <RunAgentModal
       open={...}
       agent={agent}
       template={agent.template}
       defaultOverrides={null}  // or prefilled from execution
       onClose onSuccess
     />

<ExecutionDetailPage>
  └─ <ConfigAppliedPanel
       defaultConfig={agentConfig}
       overrideConfig={execution.configOverrideJson}
       effectiveConfig={execution.effectiveConfigJson}
     />
  └─ <Button onClick={openRunWithOverrides}>Run again with these overrides</Button>
  └─ <RunAgentModal defaultOverrides={execution.configOverrideJson} ... />
```

## Field type rendering rules

Read field metadata from `template.configSchemaJson` (existing `ConfigSchema` shape: `{ key: { type, required, description, ... } }`):

| Schema type | Render as |
|---|---|
| `string` (short) | `<Input>` |
| `string` (long, has multiline hint or > 200 char default) | `<Textarea>` |
| `number` | `<Input type="number">` |
| `boolean` | `<Switch>` |
| `array<string>` | tag input or comma-separated `<Input>` (KISS = comma) |
| `enum` | `<Select>` |
| Unknown / complex | `<Textarea>` with JSON parse, fallback raw |

If schema type missing → fallback `<Textarea>` JSON.

## Related code files

### Modify
- `frontend/src/pages/agent-detail-page.tsx` — wire Run button to modal
- `frontend/src/pages/execution-detail-page.tsx` — add ConfigAppliedPanel + re-run button + modal mount
- `frontend/src/lib/api-client.ts` (or equivalent) — add `runAgent(id, { overrides? })` method if not generic enough

### Create
- `frontend/src/components/agents/run-agent-modal.tsx` — main modal
- `frontend/src/components/agents/override-form-field.tsx` — single field renderer (switch on schema type)
- `frontend/src/components/executions/config-applied-panel.tsx` — diff display
- `frontend/src/lib/overrides-diff.ts` — utility `diffOverrides(defaults, current): Record<string, unknown>`

## Implementation steps

1. **API client method** — extend existing run mutation to accept `overrides?` arg.

2. **Create `overrides-diff.ts`**
   ```ts
   export function diffOverrides(
     defaults: Record<string, unknown>,
     current: Record<string, unknown>,
   ): Record<string, unknown> {
     const out: Record<string, unknown> = {};
     for (const k of Object.keys(current)) {
       if (JSON.stringify(defaults[k]) !== JSON.stringify(current[k])) out[k] = current[k];
     }
     return out;
   }
   ```

3. **Create `override-form-field.tsx`** — accept `{ fieldKey, schema, value, defaultValue, onChange, error }`. Switch on `schema.type` per table above. Show "Default: <stringified>" hint + Reset button (sets value back to default).

4. **Create `run-agent-modal.tsx`**
   - Props: `{ open, agent, template, defaultOverrides, onClose, onSuccess }`
   - State: `formValues = { ...agent.configJson, ...(defaultOverrides ?? {}) }`
   - Filter visible fields: `template.overridableFieldsJson`
   - On Submit:
     - `overrides = diffOverrides(agent.configJson, formValues)` (only overridable keys)
     - `await runAgent(agent.id, { overrides: Object.keys(overrides).length ? overrides : undefined })`
     - On 400 → set field errors from response `details`
     - On 2xx → toast, close, navigate to new execution detail
   - Loading + error state via existing primitives

5. **Wire `agent-detail-page.tsx`**
   - Replace existing Run button onClick with `setRunModalOpen(true)`
   - Mount `<RunAgentModal>` conditionally
   - Keep loading/error patterns intact

6. **Create `config-applied-panel.tsx`**
   - Props: `{ defaultConfig, overrideConfig, effectiveConfig }`
   - If `overrideConfig == null` → render compact "Ran with default config"
   - Else → table: `Key | Default | Override` for each `Object.keys(overrideConfig)`
   - Use Tailwind table classes consistent with existing UI

7. **Wire `execution-detail-page.tsx`**
   - Mount `<ConfigAppliedPanel>` near top of execution body
   - Add "Run again with these overrides" button (only if `configOverrideJson != null`)
   - On click → `setRunModalOpen(true)` with `defaultOverrides={execution.configOverrideJson}`
   - Mount modal conditionally

8. **Type check + dev smoke** — `cd frontend && npm run type-check && npm run dev`. Open agent detail, run modal, submit. Check execution detail diff renders.

## Todo list

- [ ] Extend api client `runAgent` method
- [ ] Create `overrides-diff.ts`
- [ ] Create `override-form-field.tsx`
- [ ] Create `run-agent-modal.tsx`
- [ ] Wire agent-detail-page Run button
- [ ] Create `config-applied-panel.tsx`
- [ ] Wire execution-detail-page panel + re-run button + modal
- [ ] Type check clean
- [ ] Manual smoke: run with overrides, see diff, re-run

## Success criteria

- Click Run on Sales Lead Pipeline agent → modal shows prompt + categories + max_items prefilled
- Tweak prompt → submit → execution detail shows diff (Default vs Override)
- Click "Run again with these overrides" → modal prefilled with prior override
- Submit with no changes → no snapshot in new execution
- BE 400 (invalid key) → inline field error displayed

## Risks

| Risk | Mitigation |
|---|---|
| Schema field types missing/inconsistent across 5 templates | Fallback `<Textarea>` JSON for unknown types; spot-check during step 8 |
| Array-of-strings comma input edge cases (commas in values) | Defer — demo data clean; document as known limit |
| Modal state lost on navigation | Use shadcn Dialog (controlled), close on success only |
| Default value display ugly for objects | Stringify with 2-space indent, max 100 char preview + tooltip full |

## Security

- BE re-validates overrides (FE list is convenience only)
- No new auth surface — same JWT cookie session
- XSS: render values via React (auto-escaped), no `dangerouslySetInnerHTML`

## Next steps

→ Phase 03 (tests + demo dry-run)
