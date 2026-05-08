# Agent Operations Portal — Local Demo

Self-hosted demo proving the product model: a controlled environment where business teams run AI automation agents on a real workflow engine (n8n), with full audit trail and human-in-the-loop approval where needed.

## Architecture

```
Browser → Frontend (Vite/React) → Backend (NestJS, JWT cookie) → n8n (webhook) → callback → Backend → DB
```

**Key invariant:** Frontend never calls n8n directly. Templates, integrations, and workflow logic are owned by engineering; users compose pre-built agents.

## Prerequisites

- Docker Desktop (running)
- Node.js 18+ — only required for the speed-test script
- ~10 minutes for first-time setup

## Quick Start

```bash
git clone <repo>
cd AgentPortal
cp .env.example .env
docker compose up --build -d
```

Wait ~30s for backend health. Then:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
docker compose exec backend npm run prisma:demo-seed
```

Import n8n workflows — see [docs/n8n-workflow-setup.md](docs/n8n-workflow-setup.md). Quick path:

```bash
docker compose cp n8n-workflows n8n:/tmp/workflows
docker compose exec n8n n8n import:workflow --separate --input=/tmp/workflows
docker compose restart n8n
```

Then activate each workflow in the UI (http://localhost:5678 → toggle Active per workflow).

## Access

| Service     | URL                                  | Credentials                    |
|-------------|--------------------------------------|--------------------------------|
| Portal      | http://localhost:5173                | admin@demo.local / demo1234    |
| n8n         | http://localhost:5678                | admin / admin                  |
| Backend API | http://localhost:4000/api/health     | —                              |
| Postgres    | localhost:5432 / agent_portal        | postgres / postgres            |

## Speed Test

Validates the full execution loop end-to-end, reports p50/p95/throughput.

```bash
cd backend
npm install   # one-time
npm run speed-test -- --template gmail-lead-classifier --count 50
```

Results saved to `backend/speed-test-results/*.json`.

## Demo Walkthrough

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the 10-minute customer presentation script.

## Reset Demo State

```bash
docker compose down -v          # destroys all data + volumes
docker compose up --build -d
# then re-run the seed steps above
```

## Troubleshooting

| Symptom                                  | Cause / Fix                                                       |
|------------------------------------------|-------------------------------------------------------------------|
| Backend `502` on `/api/health`           | Migrations not applied → run `prisma migrate deploy`              |
| `n8n responded 404 Not Found` in failed  | Workflows not imported or not active — see n8n setup doc          |
| Login `MISSING_OR_NULL_ORIGIN`           | Custom client missing `Origin` header (browser/curl/UI fine)      |
| Port 5432/5173/5678/4000 already in use  | Stop conflicting service or edit ports in `docker-compose.yml`    |
| Auth fails after seed re-run             | Seed is idempotent — verify `BETTER_AUTH_SECRET` consistent in `.env` |

## Tech Stack

| Layer       | Choice                                         |
|-------------|------------------------------------------------|
| Frontend    | React 19 + Vite + TanStack Query + Tailwind v4 |
| Backend     | NestJS 11 + Prisma 7 + Better Auth             |
| Database    | PostgreSQL 15                                  |
| Automation  | n8n (self-hosted, Docker)                      |
| Runtime     | Node 20 (alpine)                               |

## Project Layout

```
AgentPortal/
├── backend/          NestJS API + Prisma + speed-test script
├── frontend/         Vite/React UI
├── n8n-workflows/    Workflow JSON exports (import into n8n)
├── docs/             Architecture, code standards, setup guides
├── plans/            Phase-by-phase implementation plans
└── docker-compose.yml
```

## Status & Scope

This is a **local demo build**, not production-ready. Notable scope decisions:

- Single workspace (`workspace_demo`), single seeded admin user
- Better Auth secret + n8n basic auth credentials are demo defaults — rotate before any real deployment
- n8n commercial licensing requires legal review before SaaS use
- All integrations are mocked (Slack/Gmail/Helpdesk return synthetic data via n8n)

## License

UNLICENSED — internal demo. See `package.json`.
