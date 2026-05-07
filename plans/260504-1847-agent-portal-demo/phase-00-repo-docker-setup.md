# Phase 00: Repo + Docker Setup

**Day:** Day 1 (May 6, 2026)  
**Priority:** Critical  
**Status:** Complete

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §8: Local Docker Compose structure
- No prior phase

## Overview
Bootstrap the monorepo, Docker Compose stack, NestJS backend skeleton, and React/Vite frontend skeleton. End state: `docker compose up --build` starts all 4 services and everything is reachable.

## Prerequisites
- Docker Desktop running on Windows
- Node.js 18+ installed
- Working directory: `C:\Users\Vincere\Desktop\Claude\AgentPortal`

## Files to Create

```
AgentPortal/
├── docker-compose.yml
├── .env.example
├── .env                         (copy of .env.example — gitignored)
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       └── health/
│           ├── health.controller.ts
│           └── health.module.ts
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.tsx
        └── App.tsx
```

## Implementation Steps

1. **Init backend** — `cd backend && npx @nestjs/cli new . --package-manager npm --skip-git`
   - Remove generated AppController/AppService (keep AppModule)
   - Add `/health` endpoint returning `{ status: 'ok', timestamp: new Date() }`

2. **Init frontend** — `npm create vite@latest frontend -- --template react-ts`
   - Install Tailwind CSS + shadcn/ui prerequisites: `tailwindcss postcss autoprefixer`
   - Install `axios` for API calls

3. **Backend Dockerfile**
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build
   EXPOSE 4000
   CMD ["node", "dist/main"]
   ```

4. **Frontend Dockerfile** (dev mode for demo)
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   EXPOSE 5173
   CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
   ```

5. **docker-compose.yml** with 4 services:
   - `postgres`: image `postgres:15`, port 5432, volume `pgdata`
   - `n8n`: image `n8nio/n8n`, port 5678, volume `n8n_data`, env `N8N_BASIC_AUTH_ACTIVE=true`
   - `backend`: build from `./backend`, port 4000, depends_on postgres, env from `.env`
   - `frontend`: build from `./frontend`, port 5173, depends_on backend

6. **.env.example**
   ```env
   NODE_ENV=development
   BACKEND_PORT=4000
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/agent_portal
   N8N_BASE_URL=http://n8n:5678
   N8N_WEBHOOK_BASE_URL=http://n8n:5678/webhook
   N8N_CALLBACK_SECRET=local-demo-secret
   BACKEND_CALLBACK_URL=http://backend:4000/api/n8n/callback
   FRONTEND_URL=http://localhost:5173
   BETTER_AUTH_SECRET=demo-secret-change-in-prod
   BETTER_AUTH_URL=http://localhost:4000
   ```

7. **Backend main.ts** — listen on `BACKEND_PORT` (default 4000), set global prefix `/api`, enable CORS for frontend URL

8. **Health endpoint** — `GET /api/health` returns 200 `{ status: 'ok', timestamp }`. No auth required.

9. **.gitignore** — include `node_modules/`, `dist/`, `.env`, `*.env.local`

10. **Verify**: `docker compose up --build` → all 4 services start without error

## Done Criteria
- [ ] `curl http://localhost:4000/api/health` → `{"status":"ok"}`
- [ ] `http://localhost:5173` loads React app in browser
- [ ] `http://localhost:5678` loads n8n UI
- [ ] `docker compose ps` shows all 4 services as running
- [ ] No hardcoded secrets — all config from `.env`

## Handoff Notes (for Phase 01)
- Backend runs at `http://localhost:4000`, global prefix `/api`
- PostgreSQL at `localhost:5432`, database `agent_portal`, user `postgres`, password `postgres`
- `DATABASE_URL` in `.env` = `postgresql://postgres:postgres@postgres:5432/agent_portal`
- `docker compose up --build` from repo root starts all services
- Backend source: `backend/src/`, NestJS module pattern
- Frontend source: `frontend/src/`, Vite + React + TypeScript
