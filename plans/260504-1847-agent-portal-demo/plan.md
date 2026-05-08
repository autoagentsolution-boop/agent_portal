# Agent Operations Portal Demo — Implementation Plan

**Version:** 1.0 | **Date:** 2026-05-04 | **Deadline:** May 26, 2026 (buffer May 30)  
**Stack:** NestJS + Better Auth + Prisma + PostgreSQL + React + Vite + Tailwind + shadcn/ui + n8n (Docker)

## Source Docs
- `DEMO_2WEEK_PLAN.md` — sprint breakdown, 20 success criteria
- `agent_operations_portal_local_demo_spec.md` — API contracts, DB schema, n8n contracts, UI requirements

## Service URLs (Local)
| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:4000 |
| n8n | http://localhost:5678 |
| PostgreSQL | localhost:5432 |

## Phase Status

| Phase | Name | Day | Date |
|-------|------|-----|------|
| [00](phase-00-repo-docker-setup.md) | Repo + Docker Setup | Day 1 | May 6 |
| [01](phase-01-database-schema-seed.md) | Database Schema + Seed | Day 2 | May 7 |
| [02](phase-02-auth-system.md) | Auth System | Day 3 | May 8 |
| [03](phase-03-core-backend-apis.md) | Core Backend APIs | Day 4 | May 9 |
| [04](phase-04-n8n-integration-core-loop.md) | n8n Integration + Core Loop ⭐ | Day 5 | May 12 — backend complete (May 6); n8n workflow JSON pending operator UI export |
| [05](phase-05-frontend-auth-agent-pages.md) | Frontend Auth + Agent Pages | Day 6 | May 13 |
| [06](phase-06-create-agent-wizard.md) | Create Agent Wizard | Day 7 | May 14 |
| [07](phase-07-execution-ui-polling.md) | Execution UI + Polling | Day 8 | May 15 — implemented (May 7); pending live smoke test |
| [08](phase-08-n8n-workflows-2-3-approval-ui.md) | n8n Workflows #2+#3 + Approval UI | Day 9 | May 16 — done + E2E verified (May 7) |
| [09](phase-09-n8n-workflows-4-5-real-integration.md) | n8n Workflows #4+#5 + Real Integration ⭐ M6 | Day 10 | May 19 — done + E2E verified (May 7); real Slack deferred |
| [10](phase-10-notifications.md) | Notifications + Integrations | Day 11 | May 20 — done + E2E verified (May 7) |
| [11](phase-11-analytics-dashboard.md) | Analytics + Dashboard | Day 12 | May 21 — done + live FE verified (May 7) |
| [12](phase-12-speed-test-ui-polish.md) | Speed Test + UI Polish | Day 13 | May 22 — done (May 8); awaits live 50-run smoke test |
| [13](phase-13-demo-package.md) | Demo Package | Days 14–15 | May 23–26 |

## Critical Milestones
- **Phase 04 — M4:** Core E2E loop (most critical — proves product model is real)
- **Phase 09 — M6:** All 5 templates live
- **Phase 13 — M8:** All 20 success criteria pass → customer presentation ready

## Architecture Rule (Never Break)
```
Frontend → Backend (JWT-authenticated) → n8n webhook → n8n callback → Backend stores result
Frontend NEVER calls n8n directly.
```

## Context Handoff Protocol
Each phase file is self-contained. When starting a new session for a phase, provide:
1. This `plan.md`
2. The target phase file
3. The prior phase's **Handoff Notes** section

Do not pass full session history between phases.
