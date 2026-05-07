# Phase 04: n8n Integration + Core Loop

**Day:** Day 5 (May 12, 2026)  
**Priority:** CRITICAL — Most Important Milestone (M4)  
**Status:** Backend complete (2026-05-06) — n8n workflow JSON deferred to operator UI export

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §11.3: Run Agent endpoint
- Spec §11.4: n8n Callback endpoint
- Spec §12: n8n workflow contract
- Spec §14.1: Gmail Lead Classifier template
- Prior handoff: `phase-03-core-backend-apis.md` → Handoff Notes

## Overview
Implement the full E2E execution loop: POST /run → backend creates execution → triggers n8n webhook → n8n workflow processes → n8n callbacks backend → execution updated in DB. Also implements the polling endpoint. Proves the product model is real.

## Architecture (Non-Negotiable)
```
Frontend → POST /api/agent-instances/:id/run
         ← { execution_id, status: 'running' }

Frontend → poll GET /api/executions/:id every 2s
         ← { status: 'running' | 'success' | 'failed' }

n8n ← POST http://n8n:5678/webhook/gmail-lead-classifier (backend triggers this)

n8n → POST http://backend:4000/api/n8n/callback (n8n sends result back)
```

## Prerequisites
- Phase 03 complete: all CRUD APIs working, AgentInstance/Execution models in DB
- n8n running at localhost:5678
- n8n admin credentials set (basic auth)

## Files to Create / Modify

```
backend/src/modules/
├── n8n/
│   ├── n8n.module.ts
│   ├── n8n.controller.ts       (callback endpoint)
│   └── n8n.service.ts          (webhook proxy, payload builder)
├── agents/
│   └── agents.controller.ts    (add POST :id/run)
│   └── agents.service.ts       (add runAgent method)
└── executions/
    └── executions.service.ts   (add updateFromCallback method)

n8n-workflows/
└── gmail-lead-classifier.json  (n8n workflow export to import via n8n UI)
```

## Implementation Steps

### 1. n8n.service.ts — webhook proxy
```typescript
async triggerWorkflow(webhookPath: string, payload: N8nPayload): Promise<void> {
  const url = `${process.env.N8N_WEBHOOK_BASE_URL}${webhookPath}`;
  // Fire and forget — do not await result
  // n8n will callback separately
  this.httpService.post(url, payload, { timeout: 5000 })
    .pipe(catchError(err => {
      this.logger.error('n8n trigger failed', { webhookPath, error: err.message });
      return of(null);
    }))
    .subscribe();
}
```

### 2. agents.service.ts — runAgent method
```typescript
async runAgent(agentId: string, userId: string) {
  // 1. Load agent instance + template
  // 2. Validate agent status (not archived, not error without reset)
  // 3. Create execution record { status: 'running', startedAt: now(), triggerType: 'manual' }
  // 4. Build n8n payload (spec §12.1):
  const payload = {
    execution_id: execution.id,
    agent_instance_id: agentId,
    template_id: agent.templateId,
    workspace_id: agent.workspaceId,
    config: agent.configJson,
    selected_integrations: agent.integrations.map(i => i.integration.integrationKey),
    input: { mode: 'test', items: [] },
    callback: {
      url: process.env.BACKEND_CALLBACK_URL,
      secret: process.env.N8N_CALLBACK_SECRET,
    },
  };
  // 5. Trigger n8n (fire and forget)
  await this.n8nService.triggerWorkflow(template.n8nWebhookPath, payload);
  // 6. Return execution_id immediately
  return { execution_id: execution.id, status: 'running' };
}
```

### 3. POST /api/agent-instances/:id/run endpoint
```typescript
@Post(':id/run')
async run(@Param('id') id: string, @Req() req) {
  return this.agentsService.runAgent(id, req.user.id);
}
```

### 4. n8n callback endpoint (spec §11.4)
```typescript
// POST /api/n8n/callback — mark @Public() but validate secret header
@Post('callback')
@Public()
async callback(@Body() body: N8nCallbackDto, @Headers('x-demo-callback-secret') secret: string) {
  if (secret !== process.env.N8N_CALLBACK_SECRET) throw new UnauthorizedException();
  await this.executionsService.updateFromCallback(body);
  return { received: true };
}
```

### 5. executionsService.updateFromCallback
```typescript
async updateFromCallback(payload: N8nCallbackPayload) {
  // 1. Find execution by id
  // 2. Update: status, finishedAt, durationMs, metrics (inputCount, outputCount, etc.)
  // 3. Upsert ExecutionOutput with payload.result
  // 4. If status = failed/warning → create Notification
  // 5. Write AuditLog entry
}
```

### 6. Gmail Lead Classifier n8n workflow JSON
Create `n8n-workflows/gmail-lead-classifier.json` — workflow to import into n8n:

Structure:
```
Webhook Trigger (POST /webhook/gmail-lead-classifier)
→ Extract payload fields
→ Set mock email data (if input.items is empty)
→ Classify emails (mock logic: check subject for keywords → hot/warm/cold)
→ Build result JSON (spec §14.1 output format)
→ Build metrics (inputCount, outputCount, tokens estimates)
→ HTTP Request node → POST to payload.callback.url
  Headers: { "x-demo-callback-secret": payload.callback.secret }
  Body: full callback payload (spec §12.2)
→ Respond to webhook
```

Key n8n nodes: Webhook, Set, Code (for classification logic), HTTP Request.

### 7. Import workflow into n8n
Steps documented in phase for operator:
1. Open http://localhost:5678
2. Create new workflow
3. Import from JSON → paste gmail-lead-classifier.json
4. Activate workflow
5. Copy webhook URL (should match `N8N_WEBHOOK_BASE_URL/webhook/gmail-lead-classifier`)

### 8. Polling — GET /api/executions/:id
Already exists from Phase 03. Verify it returns current status from DB. Frontend will poll this every 2s.

### 9. Retry wiring
Update `executions.service.ts` retry method to call `agentsService.runAgent()` after creating new execution record.

## Done Criteria
- [ ] `POST /api/agent-instances/:id/run` → `{ execution_id, status: 'running' }` within 500ms
- [ ] n8n workflow logs show execution triggered
- [ ] `POST /api/n8n/callback` with wrong secret → 401
- [ ] `POST /api/n8n/callback` with valid payload → execution status in DB updated to `success`
- [ ] `GET /api/executions/:id` polls and eventually returns `status: 'success'` with result
- [ ] Failed execution creates a `Notification` record
- [ ] `GET /api/executions/:id` returns `outputJson` in response

## Handoff Notes (for Phase 05)
- `POST /api/agent-instances/:id/run` returns `{ data: { execution_id, status } }`
- `GET /api/executions/:id` returns execution with nested `output.outputJson` and agent info
- Callback secret: `local-demo-secret` (from `.env`), validated via timing-safe compare
- n8n workflow name: `Gmail Lead Classifier`, webhook path: `/webhook/gmail-lead-classifier`
- Frontend needs to poll `GET /api/executions/:id` every 2s until status ≠ `running`/`queued`
- Only workflow #1 exists at this stage — others added in Phase 08/09

### Implementation Deviations from Phase Spec
1. **HTTP client:** Native `fetch` (Node 22) instead of `@nestjs/axios` — avoided extra dep. `triggerWorkflow` returns `Promise<void>`; `runAgent` calls it without awaiting and attaches `.catch` that transitions execution to `failed` + creates `trigger_failed` Notification (so demo doesn't sit stuck in `running` if n8n is down). 5s timeout via `AbortController`.
2. **n8n base URL:** Service uses `process.env.N8N_BASE_URL` (not `N8N_WEBHOOK_BASE_URL`) — seed `n8nWebhookPath` already includes `/webhook/...` prefix; concatenating with `N8N_WEBHOOK_BASE_URL=http://n8n:5678/webhook` produced double `/webhook`.
3. **AuditLog actor on callback:** Uses `agentInstance.createdById` (n8n callback has no user context). Trade-off: audit shows agent owner, not run-trigger user. If trigger-user attribution is needed later, add `triggeredById` column to `Execution`.
4. **Idempotency guard (DB-level CAS):** `updateFromCallback` uses `updateMany` filtered by `status IN ('queued','running')` inside the transaction. First callback wins; subsequent ones return `{ received: true, skipped: true }`. No TOCTOU race.
5. **Notifications:** Created on `failed` (severity=critical) and `warning` (severity=warning). Plus `trigger_failed` (severity=critical) when n8n unreachable at trigger time. Success skipped per spec §11.4 step 7 ("optional").
6. **Run validation:** Allows runs from `draft`/`running`/`paused`. Rejects `archived`/`error` with 409 Conflict. Status not auto-transitioned on run — frontend handles via `PATCH :id/status`.
7. **Boot-time secret assertion:** `N8nService` constructor throws if `N8N_CALLBACK_SECRET` is unset — fails Nest boot fast rather than producing confusing 401s on every callback at runtime.

### n8n Workflow JSON — Operator Action Required
- Hand-authored stub exists at `n8n-workflows/gmail-lead-classifier.json` as reference, but not import-validated
- **Build path:**
  1. `docker compose up -d postgres n8n`
  2. Open `http://localhost:5678` (admin/admin)
  3. Create workflow per spec §12.3 + §14.1 (graph: Webhook → Code → HTTP Request → Respond)
  4. Use jsCode from existing JSON's `Classify Emails` node as starting point
  5. Activate workflow, copy webhook path `/webhook/gmail-lead-classifier`
  6. Right-click workflow → Download → overwrite `n8n-workflows/gmail-lead-classifier.json`

### Manual E2E Test Plan
1. `docker compose up -d` (full stack)
2. Seed DB: `cd backend; npm run prisma:seed`
3. Login + create agent: `POST /api/agent-instances` with `template_id=gmail-lead-classifier`
4. `POST /api/agent-instances/:id/run` → expect `{ execution_id, status: 'running' }` < 500ms
5. Poll `GET /api/executions/:id` until `status='success'` (typically <3s)
6. Verify response includes `output.outputJson.classifications`
7. Failure case: `POST /api/n8n/callback` with bad secret → 401
8. Failure case: send callback with `status='failed'` → check `Notification` row created with `severity='critical'`

### Backend-on-Host Override
If running backend via `npm run start:dev` instead of in Docker, set `BACKEND_CALLBACK_URL=http://host.docker.internal:4000/api/n8n/callback` in `.env` so n8n container can reach it.
