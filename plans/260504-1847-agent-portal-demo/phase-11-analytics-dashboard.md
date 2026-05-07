# Phase 11: Analytics + Dashboard

**Day:** Day 12 (May 21, 2026)  
**Priority:** Medium  
**Status:** Done (2026-05-07). Implemented + API smoke + live FE click-through verified via Puppeteer.

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §11.8: Analytics API
- Spec §13.1: Dashboard requirements
- Spec §13.8: Analytics page requirements
- Prior handoff: `phase-10-notifications.md` → Handoff Notes

## Overview
Implement the analytics summary API (computed from executions table) and wire it to the Analytics page and Dashboard. After this phase, the dashboard shows real data and the analytics page proves the system's operational health.

## Prerequisites
- Phase 04 complete: executions table populated with real data from n8n runs
- Phase 10 complete: routing and API client stable

## Files to Create / Modify

```
backend/src/modules/
└── analytics/
    ├── analytics.module.ts
    ├── analytics.controller.ts
    └── analytics.service.ts

frontend/src/
├── pages/
│   ├── analytics/
│   │   └── analytics-page.tsx
│   └── dashboard/
│       └── dashboard-page.tsx      (replace placeholder from Phase 05)
├── components/analytics/
│   ├── metric-card.tsx
│   ├── latest-failures-list.tsx
│   └── top-agents-list.tsx
└── hooks/
    └── use-analytics.ts
```

## Backend: Analytics Service

### GET /api/analytics/summary
```typescript
async getSummary(workspaceId: string) {
  const [
    totalAgents,
    activeAgents,
    execStats,
    p95Duration,
    tokenStats,
    latestFailures,
    topAgents,
  ] = await Promise.all([
    this.prisma.agentInstance.count({ where: { workspaceId } }),
    this.prisma.agentInstance.count({ where: { workspaceId, status: 'running' } }),
    this.prisma.execution.aggregate({
      where: { workspaceId },
      _count: { id: true },
      _avg: { durationMs: true, estimatedCostUsd: true },
      _sum: { tokensInput: true, tokensOutput: true, estimatedCostUsd: true },
    }),
    // p95: raw SQL percentile or sort + pick index
    this.getP95Duration(workspaceId),
    this.getSuccessFailureCounts(workspaceId),
    this.getLatestFailures(workspaceId, 5),
    this.getTopAgentsByExecutionCount(workspaceId, 5),
  ]);

  const successRate = totalExecutions > 0
    ? (successCount / totalExecutions * 100).toFixed(2)
    : 0;

  return { total_agents, active_agents, total_executions, success_executions,
           failed_executions, success_rate, avg_duration_ms, p95_duration_ms,
           total_tokens_input, total_tokens_output, estimated_cost_usd,
           latest_failures, top_agents };
}
```

### p95 duration (simple implementation)
```typescript
// ORDER BY duration_ms DESC, take row at index Math.floor(count * 0.05)
// Raw Prisma query or findMany + sort
```

### GET /api/analytics/agents/:id
```typescript
// Per-agent stats: execution count, success rate, avg duration, total cost
// Last 20 executions for sparkline data (optional)
```

### Response format (spec §11.8)
```json
{
  "data": {
    "total_agents": 5,
    "active_agents": 3,
    "total_executions": 120,
    "success_executions": 110,
    "failed_executions": 10,
    "success_rate": 91.67,
    "avg_duration_ms": 4200,
    "p95_duration_ms": 7800,
    "total_tokens_input": 250000,
    "total_tokens_output": 40000,
    "estimated_cost_usd": 1.25,
    "latest_failures": [],
    "top_agents": []
  }
}
```

## Frontend: Analytics Page

### analytics-page.tsx layout
```
Top row: [Total Executions] [Success Rate] [Avg Duration] [Est. Cost]
         (metric-card components — large number + label + trend arrow)

Second row: [Failed Executions] [Active Agents] [Total Tokens In] [Total Tokens Out]

Latest Failures section:
  Table: Agent | Status | Error | Time | Action
  "View" → /executions/:id

Top Agents by Execution Count:
  Table: Agent | Template | Runs | Success Rate | Avg Duration | Cost
```

### metric-card.tsx
```typescript
interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}
// Large number, label below, optional subtext (e.g. "last 24h")
```

### use-analytics.ts
```typescript
function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => apiClient.get('/analytics/summary'),
    refetchInterval: 30000,  // auto-refresh every 30s
    staleTime: 15000,
  });
}
```

## Frontend: Dashboard Page

### dashboard-page.tsx layout (replace placeholder)
```
Row 1 (mini metrics): Active Agents | Executions Today | Success Rate | Failed Today
Row 2: [Latest Errors (last 5)] | [Recent Executions (last 10)]

Latest Errors widget:
  Each row: severity icon | agent name | error snippet | time | View link

Recent Executions widget:
  Each row: status badge | agent name | duration | trigger | time | View link
```

### Data sources for dashboard
- Mini metrics: `GET /api/analytics/summary`
- Recent executions: `GET /api/executions?limit=10`
- Latest failures: embedded in analytics summary `latest_failures[]`

### Executions Today filter
Add optional `date` query param to `GET /api/executions`:
```typescript
// WHERE DATE(started_at) = CURRENT_DATE
// Count via analytics summary (add today_executions field) or client-side filter
```

## Done Criteria
- [x] `GET /api/analytics/summary` returns non-zero values after running executions (smoke: 20 execs, 50% success, $0.04 cost, p95 361ms)
- [x] Dashboard page shows real numbers (4/6 active agents, 20 executions, 50.00% success, 10 failed)
- [x] "Latest Errors" on dashboard shows recent failed executions with links to `/executions/:id`
- [x] Analytics page `success_rate` reflects live data; `refetchInterval: 30_000` keeps it fresh
- [x] Analytics auto-refreshes every 30s without page reload (RefreshCw spinner shows during refetch)
- [x] Per-agent analytics available at `GET /api/analytics/agents/:id` (smoke: Classifier 8/4/4, 50% success rate, recent_executions array)
- [x] All metric values are formatted (`50.00%`, `$0.04`, `124ms`, `361ms`, `964 / 992` tokens with locale separators)
- [x] `tsc --noEmit` clean, `vite build` clean (503KB bundle, no new errors)
- [x] Live FE click-through verified via Puppeteer: dashboard + /analytics render correctly with real data

## Implementation Notes (2026-05-07)

### Files added
```
backend/src/modules/analytics/
├── analytics.module.ts
├── analytics.controller.ts        (GET /summary, GET /agents/:id)
└── analytics.service.ts           (Promise.all() of 8 queries; raw SQL for p95 + top agents)

backend/src/app.module.ts          (register AnalyticsModule)

frontend/src/
├── lib/types.ts                   (AnalyticsSummary, AnalyticsLatestFailure, AnalyticsTopAgent, AnalyticsAgentSummary, AnalyticsAgentRecentExecution)
├── hooks/use-analytics.ts         (useAnalyticsSummary 30s/15s, useAgentAnalytics)
├── components/analytics/
│   ├── metric-card.tsx            (label + tabular-nums value, variant colors, isLoading state)
│   ├── latest-failures-list.tsx   (table, severity pill, "View" link to execution)
│   └── top-agents-list.tsx        (table, rate-tier coloring, "Open" link to agent)
├── pages/
│   ├── analytics/analytics-page.tsx   (Throughput + Reliability + Latest failures + Top agents)
│   └── dashboard/dashboard-page.tsx   (replaces placeholder; mini metrics + latest errors + recent executions)
└── router.tsx                     (drop /analytics placeholder, wire AnalyticsPage)
```

### Deviations from plan
- **`top_agents` from raw SQL, not `groupBy`**: Prisma `groupBy` can't easily join AgentInstance.name in a single trip. Single raw query with `JOIN AgentInstance` + `GROUP BY ai.id` is simpler and faster than groupBy + lookup map.
- **`p95_duration_ms` via `percentile_cont`**: Postgres-native, exact, single round trip. Plan suggested ORDER BY + index pick — that's a 50-row hand calculation that breaks at scale.
- **`active_agents` = status `'running'`**: matches `AgentsService.STATUS_TRANSITIONS` (the only state with active executions). `paused` and `error` aren't "active".
- **`Decimal` → `number` in `toNumber()`**: rounds to 4 decimals to avoid `0.0399999999...` artifacts. Token totals use raw integers.
- **No `today_executions`** field added: dashboard uses `useExecutions({ limit: 10 })` directly; "today" filter was speculative — Phase 12 speed test will surface need.
- **`Alert` has no `AlertTitle`/`AlertDescription`** sub-components — inlined as `<div>` headings to avoid touching the shared UI primitive.

### Operational concerns
- **`Promise.all()` of 8 queries**: each summary request is 8 parallel DB roundtrips. Negligible at demo scale; for prod consider a materialized view refreshed every N minutes, or cache the summary for 15s.
- **p95 raw SQL**: not indexed on `durationMs`. `EXPLAIN ANALYZE` shows seq scan — fine at <10K rows. Add index in Phase 12+ if speed test reveals the bottleneck.
- **Decimal precision**: `numeric(65,30)` in DB → 4 decimals in API. Truncation is fine for display; do NOT round before billing logic.
- **30s polling cost**: dashboard + analytics each poll independently. Two open tabs = 4 requests/min. Acceptable for demo (1 user); for prod move to SSE.
- **No workspace scoping yet**: hardcoded `WORKSPACE_ID = 'workspace_demo'` like other modules. Real auth in Phase 12+.

### Live verification
- Puppeteer login → screenshot `/` (dashboard) and `/analytics`. Both render with real data.
- Sidebar unread badge still working ("9", from prior phase).
- Console clean, no React errors, no failed network calls.

## Handoff Notes (for Phase 12)
- Analytics endpoint: `GET /api/analytics/summary` — workspace scoped via `WORKSPACE_ID` const.
- Per-agent endpoint: `GET /api/analytics/agents/:id` — returns `recent_executions[20]` for sparkline.
- Dashboard route: `/` (was placeholder, now real).
- Analytics route: `/analytics` (was placeholder, now real).
- `useAnalyticsSummary()` polls every 30s with 15s staleTime — speed test in Phase 12 will see numbers update without page reload.
- p95 query is raw SQL (`percentile_cont`). If Phase 12 introduces 50+ executions, consider adding `idx_execution_workspace_duration` (workspaceId, durationMs WHERE durationMs IS NOT NULL).
- `MetricCard` is reusable — Phase 12 speed-test results page can reuse it.
- Backend deploy gotcha (still): `docker cp src → exec npm run build → docker restart`.
- Cost values: server returns `number` (rounded to 4 decimals); `formatCost` clamps display to `$0.00` / `$X.XX` / `< $0.01`.

## Handoff Notes (for Phase 12)
- Analytics endpoint: `GET /api/analytics/summary` — no params needed, workspace scoped from session
- Dashboard route: `/` or `/dashboard` — update router if needed
- Analytics page route: `/analytics`
- `refetchInterval: 30000` on analytics query — speed test in Phase 12 should make numbers update visibly
- Speed test script (Phase 12) will create 50 executions — analytics should reflect that immediately
- All cost values stored as `Decimal` in DB — convert to `number` in response serializer
