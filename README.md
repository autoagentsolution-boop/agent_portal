# Video Content Farm — Local Agent

Personal automation: generate VN-language short-form video content (Quiz, News→Comic, Life hacks) and auto-publish to YouTube Shorts + Facebook Reels. Runs entirely on a local Docker stack. Target cost: **< 1tr VND/mo (~$20)**.

## Architecture

```
[n8n cron]
   │
   ▼
[Gemini script gen] → [Nano Banana / Pexels] → [Edge / Google Cloud TTS]
                                                       │
                                                       ▼
                                            [render-service POST /render]
                                                       │
                                                       ▼
                                  [YouTube upload] + [Facebook Reels upload]
                                                       │
                                                       ▼
                                              [Postgres run_log]
```

**Stack**

| Component | Tech | Port |
|---|---|---|
| Orchestrator | n8n (self-hosted) | 5678 |
| Render service | Node + Remotion (CPU) | 7000 |
| Database | Postgres 16 | 5432 |
| LLM | Gemini 2.5 Flash | — |
| Image gen | Nano Banana (Gemini Image API) | — |
| TTS | Edge TTS + Google Cloud TTS | — |
| Stock | Pexels + Pixabay | — |

## Prerequisites

- Docker Desktop (running, WSL2 backend on Windows)
- Node.js ≥ 20 (for `db` package + `scripts/status.ts`)
- API keys (see [`.env.example`](.env.example))

## Quick Start

End-to-end first-time setup is documented in [`docs/runbook-cold-start.md`](docs/runbook-cold-start.md) — target time to first uploaded video: **~90 minutes**.

OAuth setup (the only manual step): [`docs/oauth-setup.md`](docs/oauth-setup.md).

### Day-to-day commands

```bash
cp .env.example .env                # fill credentials per docs/oauth-setup.md
docker compose up -d postgres n8n
npm --prefix db install
npm --prefix db run migrate:deploy
docker compose --profile render up -d --build render-service

curl http://localhost:7000/health   # render-service ready
npx tsx scripts/status.ts           # last 24h status
bash scripts/check-pipeline-health.sh 1
```

## Database

Schema lives in [`db/prisma/schema.prisma`](db/prisma/schema.prisma). Prisma 7, ESM client generated into `db/generated/prisma/` (committed to git — see Trade-offs in `plans/260531-1755-video-content-farm-pivot/phase-02-render-service-scaffold.md`).

```bash
# Edit schema, then:
npm --prefix db run migrate:dev      # interactive: creates + applies migration
npm --prefix db run migrate:deploy   # production: applies pending migrations only
npm --prefix db run studio           # GUI on http://localhost:5555
```

## Repo Layout

```
AgentPortal/
├── docker-compose.yml      # postgres + n8n + render-service
├── .env.example
├── render-service/         # Node + Remotion render webhook (Phase 02)
├── n8n-workflows/          # exported workflow JSONs (Phase 04+)
├── db/migrations/          # Postgres schema (Phase 01)
├── scripts/                # CLI helpers (Phase 10)
├── docs/                   # stack docs (will be refactored)
└── plans/                  # implementation plans
    └── 260531-1755-video-content-farm-pivot/
```

## Pipelines

| Pipeline | Schedule | Cost/video | Output |
|---|---|---|---|
| Quiz / Gameshow | daily 08:00 | ~$0.05 | YT Shorts + FB Reels |
| News → Comic | daily 12:00 | ~$0.35 | YT Shorts + FB Reels |
| Life hacks | daily 18:00 | ~$0.02 | YT Shorts + FB Reels |

## Plans & Status

- **Active plan:** [`plans/260531-1755-video-content-farm-pivot/plan.md`](plans/260531-1755-video-content-farm-pivot/plan.md)
- **Design rationale:** [`plans/reports/brainstorm-260531-1755-video-content-farm-pivot.md`](plans/reports/brainstorm-260531-1755-video-content-farm-pivot.md)

## Docs

- [`docs/runbook-cold-start.md`](docs/runbook-cold-start.md) — first-time setup from `git clone`
- [`docs/oauth-setup.md`](docs/oauth-setup.md) — YouTube + Facebook OAuth procedure
- [`docs/runbook-quiz-pipeline.md`](docs/runbook-quiz-pipeline.md) — M1 operator runbook + symptom triage
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — full symptom → fix table
- [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) — 5-act walkthrough for portfolio/showcase

## Archived

The previous Agent Operations Portal demo is preserved at git tag [`archive/agent-portal-demo`](https://docs.github.com/en/get-started/using-git/about-git):

```bash
git checkout archive/agent-portal-demo
```

## Operational Notes

- **Docker contract:** render-service does **not** bind-mount source — every code change requires `docker compose build render-service`. Stale containers were the #1 source of "feature not working" in the predecessor project.
- **Postgres volume `pgdata`:** holds n8n workflows, job state, and run logs. Backup with `docker compose exec postgres pg_dump ...`.
- **n8n credentials encrypted at rest** in `n8n_data` volume — never commit this volume or `.env`.
