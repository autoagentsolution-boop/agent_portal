# AgentPortal

An AI **marketing-agent portal**. You describe a goal in a chat — *"launch a
branding campaign for my coffee brand"* — and a **Master Agent** turns it into a
pipeline of specialized agents (ideation → strategy → copywriter → image
generation → publisher) that you watch run, approve, and publish to social
platforms. Work is organized as **Flows → Campaigns → Posts**.

## Run it

**See [`SETUP.md`](SETUP.md)** for full setup and a first-run walkthrough.

The app lives in [`MKTAgent/`](MKTAgent/):

```bash
cd MKTAgent
cp .env.example .env           # generate the 2 local secrets (see SETUP.md §3)
docker compose up -d --build   # backend + Postgres (auto-migrates)
# in a second terminal:
cd web && cp .env.example .env && npm install && npm run dev
```

- Web UI → http://localhost:5173
- Backend API → http://localhost:7100

## Architecture

```
Browser UI (React/Vite, :5173)
        │  REST + Server-Sent Events
        ▼
Backend (Express + TypeScript, :7100)  ──►  Postgres (:5433)
        │
        ├── Orchestration: goal → agent DAG → executor (approval gate before publish)
        ├── copy-gen (Gemini)       ── optional key
        ├── image-gen (in-process)  ── optional key
        └── social adapters (FB / IG / Threads / LinkedIn / X) ── optional tokens
```

| Component | Tech | Port |
|-----------|------|------|
| Web UI | React + Vite | 5173 |
| Backend | Express 5 + TypeScript (Prisma) | 7100 |
| Database | Postgres 16 | 5433 |
| Orchestration | goal → agent DAG → executor, approval gate before any external write | — |

The portal boots and is fully explorable with **no third-party API keys** — only
two locally generated secrets. Keys (Gemini, social tokens) are optional and only
needed for real AI output / live publishing. See [`SETUP.md` §6](SETUP.md).

## Repo layout

```
AgentPortal/
├── SETUP.md            # ← start here to run the app
├── MKTAgent/           # the portal: backend (src/) + web UI (web/)
│   ├── docker-compose.yml   # backend app + Postgres
│   ├── src/                 # Express API, orchestration, agents, adapters
│   └── web/                 # React/Vite UI
├── docs/               # design + architecture notes
├── plans/              # implementation plans
└── n8n-workflows/      # historical reference only — NOT part of the running system
```

## History — n8n is retired

This project began as an **n8n**-based automation pipeline. It has since been
rewritten around **in-app agent orchestration**: the flow is now driven by the
Master Agent + agent DAG described above, **not n8n**. The `n8n-workflows/` folder
is kept only as a historical reference and is **not part of the running system** —
you do not need n8n to run AgentPortal.
