# MKTAgent

Marketing automation backend — social posting (FB/IG/Threads/LinkedIn/X), AI copy
generation, multi-channel lead capture, and self-managed OAuth token refresh.
Code-thuần TypeScript port of the proven n8n marketing pipeline, built to scale and
to serve as the backend for a future web/mobile app.

> The n8n workflows in `../n8n-workflows/` remain the reference + fallback and are
> **not modified**. MKTAgent runs in parallel and replaces them after parity is verified.

## Stack

- **Express 5** + **TypeScript** (run via `tsx`, no build step)
- **Prisma** + **Postgres** (own DB, port 5433) — source of truth (replaces Google Sheets)
- **Zod** env + payload validation
- **node-cron** scheduler + Postgres advisory lock (single-runner idempotency)
- **AES-256-GCM** token encryption at rest (replaces the n8n credential vault)

## Quick start

```bash
cp .env.example .env        # fill DATABASE_URL, TOKEN_ENC_KEY, MKT_* tokens
npm install
npm run prisma:generate
docker compose up -d postgres   # or point DATABASE_URL at any Postgres
npm run prisma:migrate
npm run dev                 # GET http://localhost:7100/health
```

Generate the token-encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Build phases

See `plans/.../synthetic-twirling-ripple.md`. P0 scaffold → P1 domain models →
P2 social adapters → P3 scheduler → P4 copy-gen → P5 lead capture → P6 token
refresh → P7 REST API → P8 deploy + parity cutover.

## Orchestration (goal-based agents)

A second control plane built BESIDE the data plane (live publish path untouched):

- **M1 backbone** — Master Agent extracts intent → rule-based planner builds a
  dynamic agent DAG → executor runs it with an approval gate before any
  external-write (publisher) node. `src/orchestration/`, API under `/orchestration`.
- **M2-lite demo slice** — full branding flow `ideation → strategy → concept_writer
  → infographic (real image) → publisher`. Image gen is vendored in-process
  (`src/imagegen/`, no render-service dependency); the infographic agent attaches
  the generated file to the post via the `local:` AssetStore scheme. Read-only
  `GET /connections` surfaces social connection status; the Orchestrate UI animates
  node status live over SSE. Track B (full §11 connector refactor) is post-sale.

## Layout

```
src/
  server.ts          HTTP bootstrap (/health; domain routers added per phase)
  config/env.ts      zod-validated env, fail-fast
  lib/               logger, retry, crypto (AES-256-GCM), auth (API key)
  db/client.ts       Prisma client + logRun audit helper
  social/            5 platform adapters (P2)
  scheduler/         cron + advisory lock + fan-out (P3)
  copygen/           Gemini copy generation (P4)
  leads/             webhook + form + calcom + dedupe (P5)
  tokens/            encrypted store + refresh cron (P6)
  routes/            REST CRUD + approval (P7)
  imagegen/          in-process image gen (Nano Banana), local cache (M2-lite)
  orchestration/     goal→DAG planner, executor, agent runners (M1/M2)
    registry/        agent capability menu the planner selects from
    master/          requirement analyzer, clarification, llm-json
    schemas/         goal-spec, workflow-plan, artifact contracts
prisma/schema.prisma domain models
```
