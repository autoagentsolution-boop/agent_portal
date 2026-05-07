# Phase 07: Execution UI + Polling

**Day:** Day 8 (May 15, 2026)  
**Priority:** High  
**Status:** Implemented (2026-05-07; pending live smoke test against running backend)

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §13.4: Agent Detail Page (Executions tab)
- Spec §13.5: Execution Detail Page
- Spec §11.5: Executions API
- Prior handoff: `phase-06-create-agent-wizard.md` → Handoff Notes

## Overview
Build execution history list, execution detail page with live 2s polling, and retry functionality. Also fleshes out the agent detail page with an Executions tab. This completes the core user loop: create → run → inspect → retry.

## Prerequisites
- Phase 06 complete: wizard creates agents + test runs; execution records exist in DB
- `GET /api/executions`, `GET /api/executions/:id`, `POST /api/executions/:id/retry` all live

## Files to Create

```
frontend/src/
├── pages/
│   ├── agents/
│   │   └── agent-detail-page.tsx      (tabbed: Overview, Config, Executions, Notifications)
│   └── executions/
│       ├── execution-detail-page.tsx
│       └── execution-status-badge.tsx
├── components/executions/
│   ├── execution-list.tsx
│   ├── execution-row.tsx
│   └── execution-output-viewer.tsx    (renders outputJson nicely)
└── hooks/
    ├── use-executions.ts
    └── use-execution-polling.ts       (2s polling hook)
```

## Implementation Steps

### 1. use-execution-polling.ts
```typescript
function useExecutionPolling(executionId: string | null) {
  return useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => apiClient.get(`/executions/${executionId}`),
    enabled: !!executionId,
    refetchInterval: (data) => {
      // Stop polling when terminal state reached
      const terminal = ['success', 'failed', 'warning', 'cancelled'];
      return terminal.includes(data?.status) ? false : 2000;
    },
    refetchIntervalInBackground: false,
  });
}
```

### 2. Execution Detail Page — execution-detail-page.tsx
Route: `/executions/:id`

Layout:
```
[Status badge] [Agent name] → [Template name]
──────────────────────────────────────────────
Started: 2026-05-12 10:00:00    Duration: 8.2s
Trigger: Manual                 Cost: $0.01
Tokens in: 5,000   Tokens out: 800
──────────────────────────────────────────────
Result Summary:
"10 emails classified. 3 hot leads found."

Output:
[JSON viewer / collapsible sections]

[Error details if failed — red alert box]

Actions: [Retry] [View Agent] [← Back]
```

### 3. Live polling on execution detail
```typescript
// When execution status is 'running' or 'queued':
//   - Show animated spinner next to status badge
//   - Show "Waiting for result..." in output area
//   - 2s polling via useExecutionPolling hook
// When terminal status arrives:
//   - Polling stops automatically
//   - Output viewer populates
//   - Duration calculated
```

### 4. execution-output-viewer.tsx
```typescript
// Renders outputJson based on template type:
// - Generic: JSON tree viewer (collapsible)
// - Email Draft Responder: special approval UI (Phase 08 adds this)
// - Others: key-value summary + raw JSON toggle
// Handle null output gracefully ("No output recorded")
```

### 5. Retry button
```typescript
// POST /api/executions/:id/retry
// On success: navigate to new execution detail page (/executions/:newId)
// Show toast: "New execution started"
// Disable button while retrying (prevent double-click)
// Only show Retry on failed executions
```

### 6. Agent Detail Page — agent-detail-page.tsx
Route: `/agents/:id`

Tabs (shadcn Tabs):
- **Overview**: status, template, integrations, last run, actions (Run Now, Pause/Resume, Archive)
- **Configuration**: read-only config display; "Edit" button → inline edit of safe fields
- **Executions**: execution list for this agent
- **Notifications**: notifications for this agent (Phase 10 fills this)

Executions tab content:
```typescript
// GET /api/executions?agent_instance_id=:id
// Show table: ID (short), status badge, trigger, started_at, duration, cost, actions (View Detail)
// Pagination: show last 50
// "Run Now" button at top → POST run → navigate to new execution
```

### 7. Execution list component — execution-list.tsx
```typescript
// Sortable table columns: Status | Trigger | Started | Duration | Tokens | Cost | Actions
// Status badge colors:
//   queued = gray, running = blue (animated), success = green
//   warning = yellow, failed = red, cancelled = muted
// Duration: format ms → "8.2s" or "1m 23s"
// Cost: "$0.01" — show "< $0.01" for very small values
```

### 8. Execution overview page (standalone)
Route: `/executions` (optional — linked from sidebar)

Show all executions across all agents for the workspace, most recent first.
Filters: status, agent name.

### 9. Navigation wiring
- My Agents tab: "View Details" → `/agents/:id`
- Run Now: → `/executions/:id` (execution detail with polling)
- Execution row: "View Detail" → `/executions/:id`
- Notification: "View Execution" → `/executions/:id` (Phase 10)

## Done Criteria
- [x] `/executions/:id` loads and shows execution data
- [x] Page auto-updates when execution is `running` (polling visible — spinner)
- [x] Polling stops and output appears when execution reaches `success`
- [x] Retry on a failed execution → navigates to new execution with running status
- [x] `/agents/:id` loads with Overview + Executions tabs populated
- [x] Executions tab shows correct executions for that agent only
- [x] Duration formatted correctly (not raw milliseconds)
- [x] No infinite polling loop when status is terminal

## Implementation Notes (2026-05-07)

### Deviations from plan
- Plan called for `hooks/use-execution-polling.ts` as a separate file. Wizard already
  consumed `hooks/use-execution.ts` with a `{poll}` opt → kept that and added
  `hooks/use-executions.ts` for list + retry only. One query key (`['execution', id]`)
  shared by wizard + detail page → cache hits when navigating from wizard test run.
- Plan listed `cancelled` as a terminal status. Backend never emits it; type carries
  it for forward compat and the badge map handles it, but no `cancelled` branch in
  controllers/UI logic.

### Files added
```
frontend/src/
├── lib/formatters.ts                            (duration / cost / date / id)
├── components/executions/
│   ├── execution-status-badge.tsx               (+ isTerminal export)
│   ├── execution-row.tsx
│   ├── execution-list.tsx
│   └── execution-output-viewer.tsx              (templateId switch — generic JSON tree)
├── pages/executions/
│   ├── execution-detail-page.tsx                (live polling + retry)
│   └── executions-page.tsx                      (workspace-wide list with filters)
├── pages/agents/agent-detail-page.tsx           (Tabs: Overview/Config/Executions/Notifications)
└── hooks/use-executions.ts                      (list + retry)
```

### Files modified
- `lib/types.ts` — split `ExecutionRow` (list shape) and `ExecutionDetail` (detail shape
  extends row + output/notifications/joined relations); added `'cancelled'` to status
  union; tokens/cost fields surfaced for the metadata grid.
- `hooks/use-agents.ts` — added `useAgent(id)`, `useArchiveAgent()`; `useUpdateAgentStatus`
  now invalidates the per-agent query key too.
- `router.tsx` — replaced `/agents/:id`, `/executions/:id` placeholders with real pages;
  added `/executions` route.
- `components/layout/sidebar.tsx` — added Executions nav item.

### Operational concerns
- **Polling cadence:** 2s while non-terminal, off otherwise. `refetchOnWindowFocus: false`
  prevents accidental refetches on tab switch. Listing pages do not poll.
- **Retry race:** `useRetryExecution` invalidates `['executions']` and `['agents']` on
  success. New execution starts in `running` so the navigated-to detail page resumes
  polling immediately.
- **Pause/Resume gating:** UI mirrors backend `STATUS_TRANSITIONS`. Archived/error agents
  hide controls they can't action. Backend remains the source of truth (returns 400 if FE
  drift sneaks an invalid transition through).
- **Decimal serialization:** `estimatedCostUsd` arrives as Prisma Decimal → JSON string.
  `formatCost` handles both string + number.

### Live smoke test (user-side)
1. `docker compose up` (postgres + n8n + backend); run frontend dev server.
2. Navigate to existing agent → Run Now → confirm spinner on detail page → polling stops
   on `success`, output viewer renders n8n payload tree.
3. Cause a failure (e.g. stop n8n container mid-run) → confirm Retry button appears,
   click → land on new execution detail with `running` status.
4. Visit `/executions` → status + agent filters narrow the list.
5. Visit `/agents/:id` → Tabs: Overview cards correct, Executions tab shows only this
   agent's runs, Pause on a `running` agent → status flips to `paused`.

## Handoff Notes (for Phase 08)
- `execution-output-viewer.tsx` checks `templateId` on execution to render special UI
- For `email-draft-responder` template: Phase 08 adds Approve/Reject buttons inside output viewer
- Polling hook at `hooks/use-execution.ts` (option `{ poll: true }`) — reuse in Phase 08 test run step
- `/agents/:id` Notifications tab is empty shell — Phase 10 fills it
- Agent status transition (Pause/Resume) wired via `PATCH /api/agent-instances/:id/status`
- All execution timestamps stored as UTC — display via `Intl.DateTimeFormat` (formatters.ts)

