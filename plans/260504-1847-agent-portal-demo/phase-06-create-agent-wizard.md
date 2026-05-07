# Phase 06: Create Agent Wizard

**Day:** Day 7 (May 14, 2026)  
**Priority:** High  
**Status:** Implemented + UX hardening done (2026-05-06; pending live smoke test against backend)

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §13.3: Create Agent Wizard (7 steps)
- Prior handoff: `phase-05-frontend-auth-agent-pages.md` → Handoff Notes

## Overview
Build the 7-step wizard that guides users from template selection to agent activation. Critical requirement: Step 3 must only show integrations allowed by the selected template, and Step 4 must render the dynamic config form from `config_schema`. Wizard submits to `POST /api/agent-instances` on final step.

## Prerequisites
- Phase 05 complete: auth, routing, API client, shadcn/ui available
- `GET /api/agent-templates/:id` returns full configSchemaJson

## Files to Create

```
frontend/src/
├── pages/agents/
│   └── create-agent-page.tsx     (wizard container — replaces /agents/new placeholder)
├── components/wizard/
│   ├── wizard-shell.tsx           (step indicator + navigation buttons)
│   ├── step-01-select-template.tsx
│   ├── step-02-review-scope.tsx
│   ├── step-03-select-integrations.tsx
│   ├── step-04-configure-fields.tsx
│   ├── step-05-select-trigger.tsx
│   ├── step-06-test-run.tsx
│   ├── step-07-activate.tsx
│   └── dynamic-config-form.tsx    (renders form fields from config_schema)
└── hooks/
    └── use-integrations.ts
```

## Wizard State Shape
```typescript
interface WizardState {
  templateId: string | null;
  template: AgentTemplate | null;       // loaded from API
  agentName: string;
  selectedIntegrations: string[];       // integration keys
  config: Record<string, unknown>;
  triggerMode: 'manual' | 'schedule';
  testExecutionId: string | null;
  testStatus: 'idle' | 'running' | 'success' | 'failed';
}
```

## Implementation Steps

### 1. wizard-shell.tsx
```typescript
// Manages currentStep (1–7) and wizardState
// Step indicator: numbered circles, completed = filled, current = outlined, future = gray
// Back/Next buttons — Next is disabled if current step invalid
// Step validation before advancing (client-side only — server validates on submit)
```

### 2. Step 1 — Select Template
```typescript
// Show template cards (same as TemplatesTab but selectable)
// On select: set templateId, fetch full template detail (for configSchemaJson)
// Highlight selected card with border ring
// Next disabled until template selected
```

### 3. Step 2 — Review Task Scope
```typescript
// Display (read-only) from loaded template:
//   - description, taskScope
//   - limitations[] list
//   - required_integrations[], optional_integrations[]
//   - allowed_trigger_modes[]
//   - approval_required badge
//   - cost_level badge
// No input — Next always enabled
// Also: name input field ("Name your agent") — required
```

### 4. Step 3 — Select Integrations (Critical)
```typescript
// Fetch GET /api/integrations (workspace integrations)
// Filter: only show integrations whose key is in
//   template.required_integrations OR template.optional_integrations
// NEVER show integrations not in this list
// Required integrations: pre-checked, cannot uncheck
// Optional integrations: toggle checkbox
// Show integration status badge (mock_connected, not_connected, etc.)
// Warn if integration is not_connected
// Next disabled if any required integration is not selected
```

### 5. Step 4 — Configure Fields (Critical)
```typescript
// dynamic-config-form.tsx renders form from template.configSchemaJson
// Supported field types:
//   string → Input
//   number → Input type="number" with min/max
//   boolean → Switch / Checkbox
//   select → Select dropdown (options from schema)
//   textarea → Textarea
// Required fields: show asterisk, validate non-empty before Next
// Default values: pre-fill from schema.default
// Validation runs on Next click — highlight invalid fields
```

### 6. Step 5 — Select Trigger Mode
```typescript
// Radio group: Manual / Schedule (mock)
// Only show modes in template.allowed_trigger_modes
// Manual: description "Run on demand"
// Schedule: mock — show frequency selector (daily/hourly) — stored in config but not enforced
// Webhook: show as disabled if not in allowed modes
```

### 7. Step 6 — Test Run
```typescript
// Button: "Run Test"
// On click:
//   1. Submit wizard state → POST /api/agent-instances (creates agent as draft)
//   2. POST /api/agent-instances/:id/run
//   3. Poll GET /api/executions/:id every 2s (max 30s timeout)
//   4. Show spinner while running
//   5. Success: show result summary from execution output
//   6. Failure: show error message + "Try Again" option
// Store agentId in wizard state
// Next enabled after test completes (success or failure)
```

### 8. Step 7 — Activate Agent
```typescript
// Show summary: agent name, template, integrations, trigger mode
// Button: "Activate Agent"
// On click: PATCH /api/agent-instances/:agentId/status { status: 'running' }
// On success: navigate to /agents with My Agents tab active
// Confetti or success toast optional
```

### 9. Route
```typescript
// /agents/new → CreateAgentPage
// Optional: /agents/new?template=:id → pre-select template in Step 1
```

### 10. Validation summary
- Step 1: template selected
- Step 2: agent name not empty
- Step 3: all required integrations selected
- Step 4: all required config fields non-empty, number fields within min/max
- Step 5: trigger mode selected
- Step 6: test run completed (or skipped with warning)
- Step 7: activate

## Done Criteria
- [ ] Wizard opens from "Create Agent" button on Templates tab
- [ ] Step 3 shows ONLY integrations allowed by selected template (not all 6)
- [ ] Required integrations cannot be deselected
- [ ] Step 4 renders dynamic form matching template's config_schema fields
- [ ] Submitting with missing required config field prevents Next advance
- [ ] Step 6 test run creates execution visible in DB
- [ ] Step 7 "Activate" sets agent status to `running`
- [ ] Completing wizard: agent appears in My Agents tab

## Handoff Notes (for Phase 07)
- Test run in Step 6 creates an execution — execution_id available from wizard state
- After wizard completes, user can view executions on `/agents/:id` detail page
- Agent detail page route `/agents/:id` is placeholder — Phase 07 may flesh it out partially
- Wizard state is local React state (useState/useReducer) — not persisted
- `POST /api/agent-instances` creates agent as `draft` initially
- Status transition `draft → running` via `PATCH /api/agent-instances/:id/status`

## Post-implementation Adjustments (2026-05-06)

### Test-run UX hardening
- Added `'skipped'` to `TestStatus`. `canAdvance` step 6 now allows `success | failed | skipped`.
- Step 6 has a **Skip test** button: creates the agent (if not yet) and lets user proceed without firing a test execution.
- Raw error dumps removed from the UI. New `friendly-test-error.ts` maps trigger/runtime/timeout failures to title + hint pairs. Raw detail hidden behind a "Show details" toggle.
- On success, Step 6 surfaces `resultSummary` and execution duration (badge).

### Schedule frequency persistence
- Renamed config key `_schedule_frequency` → `schedule_frequency` so it persists in `agentInstance.configJson` for analytics ("which user uses which schedule").
- Reducer's `setTriggerMode` now scrubs `schedule_frequency` from config when switching away from `schedule` (avoids stale state).
- Backend `validateConfig` ignores keys not in template schema → no validation impact.

### Auto-archive abandoned drafts
- `useCreateAgent` returns an agentId in Step 6. If the user never reaches "Activate", the draft would otherwise linger in DB.
- `CreateAgentPage` now tracks `agentIdRef` + `activatedRef`. On unmount (or `beforeunload`), if a draft was created but never activated, it fires `DELETE /api/agent-instances/:id` (best-effort, fetch + `keepalive: true` for tab close).
- `archiveAgentSilently` helper exported from `use-agents.ts` — error-swallowing, intentional.
- **Caveat:** browser crashes / forced kills can still leak drafts. A backend cron (Phase 11+ candidate) is the canonical garbage collector; this is the demo-grade safety net.
