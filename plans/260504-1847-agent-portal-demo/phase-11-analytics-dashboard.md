# Phase 11: Analytics + Dashboard

**Day:** Day 12 (May 21, 2026)  
**Priority:** Medium  
**Status:** Pending

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
- [ ] `GET /api/analytics/summary` returns non-zero values after running executions
- [ ] Dashboard page shows real numbers (not zeros or hardcoded)
- [ ] "Latest Errors" on dashboard shows recent failed executions with links
- [ ] Analytics page `success_rate` updates after running more executions
- [ ] Analytics auto-refreshes every 30s without page reload
- [ ] Per-agent analytics available at `GET /api/analytics/agents/:id`
- [ ] All metric values are formatted (e.g. "91.67%" not "0.9167", "$1.25" not "1.25")

## Handoff Notes (for Phase 12)
- Analytics endpoint: `GET /api/analytics/summary` — no params needed, workspace scoped from session
- Dashboard route: `/` or `/dashboard` — update router if needed
- Analytics page route: `/analytics`
- `refetchInterval: 30000` on analytics query — speed test in Phase 12 should make numbers update visibly
- Speed test script (Phase 12) will create 50 executions — analytics should reflect that immediately
- All cost values stored as `Decimal` in DB — convert to `number` in response serializer
