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

- Docker Desktop (running)
- API keys (see [`.env.example`](.env.example))

## Quick Start

```bash
cp .env.example .env
# Fill required keys: GEMINI_API_KEY, PEXELS_API_KEY, YT_OAUTH_*, FB_PAGE_*

docker compose up -d postgres n8n
# n8n UI: http://localhost:5678 (login from N8N_BASIC_AUTH_*)
# Postgres: localhost:5432 (creds from POSTGRES_*)

# Render service (added in Phase 02):
docker compose --profile render up -d render-service
# Health: curl http://localhost:7000/health
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

## Archived

The previous Agent Operations Portal demo is preserved at git tag [`archive/agent-portal-demo`](https://docs.github.com/en/get-started/using-git/about-git):

```bash
git checkout archive/agent-portal-demo
```

## Operational Notes

- **Docker contract:** render-service does **not** bind-mount source — every code change requires `docker compose build render-service`. Stale containers were the #1 source of "feature not working" in the predecessor project.
- **Postgres volume `pgdata`:** holds n8n workflows, job state, and run logs. Backup with `docker compose exec postgres pg_dump ...`.
- **n8n credentials encrypted at rest** in `n8n_data` volume — never commit this volume or `.env`.
