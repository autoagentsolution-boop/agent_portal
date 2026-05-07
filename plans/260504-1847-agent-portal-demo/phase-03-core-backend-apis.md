# Phase 03: Core Backend APIs

**Day:** Day 4 (May 9, 2026)  
**Priority:** Critical  
**Status:** Complete

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §11: Backend API spec (all endpoints)
- Spec §9.3–9.6: Entity definitions
- Prior handoff: `phase-02-auth-system.md` → Handoff Notes

## Overview
Implement all CRUD REST endpoints for Templates, Agent Instances, Integrations, Executions (list/detail), and Notifications (list only). Critical: agent creation must enforce all template validation rules from spec §11.2. This phase locks the API contract — later phases must not change endpoint signatures.

## Prerequisites
- Phase 02 complete: Auth guard active, PrismaService injectable
- Zod installed: `npm install zod`

## Files to Create

```
backend/src/modules/
├── templates/
│   ├── templates.module.ts
│   ├── templates.controller.ts
│   └── templates.service.ts
├── agents/
│   ├── agents.module.ts
│   ├── agents.controller.ts
│   ├── agents.service.ts
│   └── dto/
│       ├── create-agent.dto.ts     (Zod schema)
│       ├── update-agent.dto.ts
│       └── update-status.dto.ts
├── integrations/
│   ├── integrations.module.ts
│   ├── integrations.controller.ts
│   └── integrations.service.ts
├── executions/
│   ├── executions.module.ts
│   ├── executions.controller.ts
│   └── executions.service.ts
└── notifications/
    ├── notifications.module.ts
    ├── notifications.controller.ts
    └── notifications.service.ts
```

## API Contract (locked after this phase)

### Templates
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/agent-templates | ✓ | List all active templates |
| GET | /api/agent-templates/:id | ✓ | Template detail with full config schema |

### Agent Instances
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/agent-instances | ✓ | List (query: status, template_id) |
| GET | /api/agent-instances/:id | ✓ | Detail |
| POST | /api/agent-instances | ✓ | Create with full validation |
| PATCH | /api/agent-instances/:id | ✓ | Update safe fields only |
| PATCH | /api/agent-instances/:id/status | ✓ | Status transition |
| DELETE | /api/agent-instances/:id | ✓ | Archive (soft delete) |

### Integrations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/integrations | ✓ | List workspace integrations |
| POST | /api/integrations/:id/mock-connect | ✓ | Set status = mock_connected |
| POST | /api/integrations/:id/test | ✓ | Mock test, update lastTestedAt |
| POST | /api/integrations/:id/disconnect | ✓ | Set status = not_connected |

### Executions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/executions | ✓ | List (query: agent_instance_id, status, limit) |
| GET | /api/executions/:id | ✓ | Detail with output + related agent |
| POST | /api/executions/:id/retry | ✓ | Create new execution from failed one |

### Notifications
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/notifications | ✓ | List (query: status, severity) |
| PATCH | /api/notifications/:id/acknowledge | ✓ | status → acknowledged |
| PATCH | /api/notifications/:id/resolve | ✓ | status → resolved |

## Implementation Steps

### 1. Zod validation pipe — global
```typescript
// Install: npm install nestjs-zod
// Or manual: ZodValidationPipe at app level
```

### 2. Templates module
- `GET /api/agent-templates` — return all `status: 'active'` templates (exclude configSchemaJson from list, include in detail)
- `GET /api/agent-templates/:id` — full record including configSchemaJson and outputContractJson
- Parse JSON fields from DB strings before returning

### 3. Agent creation validation (spec §11.2 — 9 rules)
```typescript
async create(dto: CreateAgentDto, workspaceId: string, userId: string) {
  const template = await this.findTemplate(dto.templateId);
  
  // Rule 1+2: template exists and is active
  // Rule 3: all required_integrations are in selected_integrations
  // Rule 4: selected_integrations ⊆ required + optional
  // Rule 5: each selected integration exists in workspace registry
  // Rule 6: trigger_mode in allowed_trigger_modes
  // Rule 7+8+9: validate config against config_schema (required fields, type check, min/max)
  
  if (validationErrors.length) throw new BadRequestException(validationErrors);
  
  // Create agent + link integrations in transaction
}
```

### 4. Config schema validator utility
```typescript
// src/utils/config-schema-validator.ts
// Validates configJson against configSchemaJson from template
// Supports types: string, number, boolean, select, textarea
// Enforces required, min, max
```

### 5. Status transition guard (spec §11.2)
```
draft → running
running → paused | error | archived
paused → running | archived
error → paused | running
```
Reject invalid transitions with 400.

### 6. Retry execution
```typescript
// POST /api/executions/:id/retry
// 1. Load old execution
// 2. Verify agent still valid
// 3. Create new execution (status: queued)
// n8n trigger happens in Phase 04 — for now just create record
```

### 7. Workspace scoping
All queries must filter by workspace. Extract workspaceId from session user. For demo: all users belong to `workspace_demo`.

### 8. Response format — consistent envelope
```json
// List: { "data": [...], "total": N }
// Single: { "data": {...} }
// Error: { "error": "message", "details": [] }
```

## Done Criteria
- [ ] `GET /api/agent-templates` → 5 templates (no auth → 401)
- [ ] `POST /api/agent-instances` with missing required integration → 400 with descriptive error
- [ ] `POST /api/agent-instances` with invalid config field → 400
- [ ] `POST /api/agent-instances` with valid payload → 201, agent in DB
- [ ] `PATCH /api/agent-instances/:id/status` invalid transition → 400
- [ ] `GET /api/integrations` → 6 integrations
- [ ] `POST /api/integrations/:id/mock-connect` → integration status updated

## Handoff Notes (for Phase 04)
- `POST /api/agent-instances/:id/run` endpoint does NOT exist yet — Phase 04 adds it
- `AgentsService.createExecution()` helper does NOT exist yet — Phase 04 adds it
- Retry endpoint creates execution record but does not trigger n8n yet — Phase 04 wires that
- Config schema validation utility at `backend/src/utils/config-schema-validator.ts`
- All responses use `{ data: ... }` envelope
- Workspace ID for demo: all users → `workspace_demo`
- Agent statuses: `draft | running | paused | error | archived`
- Execution statuses: `queued | running | success | warning | failed | cancelled`
