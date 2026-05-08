# Phase 12: Speed Test + UI Polish

**Day:** Day 13 (May 22, 2026)  
**Priority:** Medium  
**Status:** Implemented 2026-05-08 — pending live 50-run smoke test against running n8n

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §15: Speed test requirement
- Prior handoff: `phase-11-analytics-dashboard.md` → Handoff Notes

## Overview
Implement the speed test script that fires N executions against a template and measures throughput. Polish all loading, empty, and error states across the frontend. These two concerns are independent and can be implemented concurrently.

## Prerequisites
- Phase 11 complete: all pages implemented, analytics working
- All 5 n8n workflows active
- At least 1 agent instance exists (gmail-lead-classifier preferred for speed test)

## Files to Create / Modify

```
backend/src/scripts/
└── speed-test.ts               (create — run via ts-node or compiled)

backend/package.json            (add speed-test script)

frontend/src/components/
├── ui/
│   ├── loading-skeleton.tsx    (reusable skeleton variants)
│   └── empty-state.tsx         (reusable empty state component)
└── error-boundary.tsx          (React error boundary wrapper)
```

## Speed Test Script

### Usage
```bash
npm run speed-test -- --template gmail-lead-classifier --count 50
npm run speed-test -- --template gmail-lead-classifier --count 10
npm run speed-test -- --template gmail-lead-classifier --count 100
```

### package.json script
```json
"speed-test": "ts-node src/scripts/speed-test.ts"
```

### speed-test.ts implementation
```typescript
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

async function main() {
  const args = parseArgs();  // --template, --count, --agent-id (optional)
  const { template, count, agentId } = args;

  // 1. Find or create agent instance for template
  const agent = agentId
    ? await getAgent(agentId)
    : await findOrCreateTestAgent(template);

  // 2. Login to get session (use demo credentials)
  const sessionCookie = await login();

  // 3. Fire executions sequentially (not concurrent — local n8n can't handle parallel well)
  const results: ExecutionResult[] = [];
  const totalStart = Date.now();

  for (let i = 0; i < count; i++) {
    const start = Date.now();
    try {
      const { execution_id } = await runAgent(agent.id, sessionCookie);
      const execution = await pollUntilComplete(execution_id, sessionCookie, 30_000);
      results.push({
        index: i + 1,
        execution_id,
        status: execution.status,
        duration_ms: execution.durationMs ?? Date.now() - start,
        backend_response_ms: Date.now() - start,
      });
    } catch (err) {
      results.push({ index: i + 1, status: 'error', error: String(err) });
    }
    process.stdout.write(`\r[${i + 1}/${count}] ...`);
  }

  const totalMs = Date.now() - totalStart;

  // 4. Compute stats
  const successes = results.filter(r => r.status === 'success');
  const failures = results.filter(r => r.status !== 'success');
  const durations = successes.map(r => r.duration_ms).sort((a, b) => a - b);

  const output = {
    test_name: `${count} execution local test`,
    template_id: template,
    total_executions: count,
    success_count: successes.length,
    failed_count: failures.length,
    avg_duration_ms: mean(durations),
    p50_duration_ms: percentile(durations, 50),
    p95_duration_ms: percentile(durations, 95),
    total_elapsed_ms: totalMs,
    throughput_per_min: Math.round(count / (totalMs / 60000)),
    callback_missing_count: results.filter(r => r.status === 'error').length,
    database_write_errors: 0,
    notes: failures.length > 0 ? `${failures.length} failures encountered` : 'All executions completed successfully',
  };

  console.log('\n\n--- Speed Test Results ---');
  console.log(JSON.stringify(output, null, 2));

  // 5. Save results to file
  const filename = `speed-test-${template}-${count}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${filename}`);
}
```

### Helper functions
```typescript
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

async function pollUntilComplete(executionId, cookie, timeoutMs): Promise<Execution> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await apiClient.get(`/executions/${executionId}`, { headers: { Cookie: cookie } });
    if (['success', 'failed', 'warning', 'cancelled'].includes(res.data.data.status)) {
      return res.data.data;
    }
    await sleep(500);
  }
  throw new Error(`Execution ${executionId} timed out after ${timeoutMs}ms`);
}
```

## Frontend UI Polish

### Loading states — every data fetch needs a skeleton

Pages and their skeleton patterns:
| Page | Skeleton |
|------|----------|
| Templates tab | 5 card skeletons (h-48 each) |
| My Agents tab | 3 row skeletons |
| Execution list | 10 row skeletons |
| Execution detail | Header skeleton + output area skeleton |
| Analytics page | 8 metric card skeletons |
| Dashboard | 4 mini metric skeletons + 2 list skeletons |
| Notifications | 5 notification card skeletons |
| Integrations | 6 integration card skeletons |

### loading-skeleton.tsx
```typescript
// Thin wrapper around shadcn Skeleton with preset variants:
// CardSkeleton, RowSkeleton, MetricSkeleton, TextLineSkeleton
```

### Empty states — empty-state.tsx
```typescript
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```

Page-specific empty states:
- My Agents tab: "No agents yet" + "Create your first agent" button
- Execution list: "No executions yet" + "Run your agent" button
- Notifications: "All clear — no notifications" + checkmark icon
- Analytics: "Run some agents to see analytics"

### Error states — consistent pattern
```typescript
// All useQuery errors show:
// [AlertTriangle icon] "Failed to load [resource]"
// [Retry button] → refetch()
// Optional: show error.message in small text below
```

### Error boundary — error-boundary.tsx
```typescript
// Wraps router outlet
// Catches unexpected React errors
// Shows "Something went wrong" with reload button
// Prevents full white screen
```

### Misc polish checklist
- [ ] All buttons show loading spinner when async action in flight (`isLoading` state)
- [ ] Toast notifications for all mutations (success + error)
- [ ] Confirmation dialog for Archive agent and Disconnect integration
- [ ] Mobile-responsive layout (not required for demo but Tailwind makes it free)
- [ ] Page titles set correctly (`<title>Agents | Agent Portal</title>`)

## Done Criteria
- [ ] `npm run speed-test -- --template gmail-lead-classifier --count 50` runs 50 executions
- [ ] Script outputs JSON with p50, p95, success_count, failed_count
- [ ] Analytics page updates visibly after speed test completes (30s refresh)
- [ ] All pages show skeleton while data loads (no content flash)
- [ ] Empty states show on My Agents tab for a fresh workspace
- [ ] All error states show retry button that actually refetches
- [ ] No unhandled promise rejection errors in browser console

## Handoff Notes (for Phase 13)
- Speed test results saved as JSON files in repo root or `speed-test-results/`
- Script uses `admin@demo.local` / `demo1234` credentials — must be seeded
- Loading/empty/error states now consistent across all pages
- Phase 13 only needs: demo data enrichment, README, demo script, final verification
- No more code changes after Phase 13 except bug fixes found during dry run
