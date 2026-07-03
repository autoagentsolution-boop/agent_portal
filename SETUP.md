# AgentPortal — Setup Guide

An AI **marketing-agent portal**. You describe a goal in a chat ("launch a
branding campaign for my coffee brand"), and a **Master Agent** turns it into a
pipeline of specialized agents — ideation → strategy → copywriter → image
generation → publisher — that you can watch run, approve, and publish to social
platforms. Work is organized as **Flows → Campaigns → Posts**.

> **Run this app from the [`MKTAgent/`](MKTAgent/) folder.** The `MKTAgent` backend
> + its React UI *are* the portal. The root `README.md` documents an older,
> retired video pipeline — ignore it; this file is the current source of truth.

---

## What you get

- **Orchestrate** — a chat where you state a marketing goal and the agent plans
  the work, asks clarifying questions, and builds a visual agent graph (DAG).
- **Flows / Campaigns / Posts** — a saved Flow is a reusable blueprint; a Campaign
  groups strategy; a Post is one executable piece of content you can run, re-run,
  and edit independently.
- **Real AI output** — copy generation (Gemini) and image generation run
  in-process; generated images attach to posts automatically.
- **Connections** — a panel to (optionally) link Facebook / Instagram / Threads /
  LinkedIn / X for live publishing. **Not required to explore the app.**

### Architecture at a glance

```
Browser UI (React/Vite, :5173)
        │  REST + Server-Sent Events
        ▼
Backend (Express + TypeScript, :7100)  ──►  Postgres (:5433)
        │
        ├── Orchestration: goal → agent DAG → executor (approval gate before publish)
        ├── copy-gen (Gemini)     ── optional key
        ├── image-gen (in-process) ── optional key
        └── social adapters (FB/IG/Threads/LinkedIn/X) ── optional tokens
```

---

## 1. Prerequisites

| Tool | Why | Check |
|------|-----|-------|
| **Docker Desktop** | Runs the backend + Postgres. Must be **running**; on Windows enable the WSL2 backend. | `docker --version` |
| **Node.js ≥ 20** | Runs the web UI (not containerised). | `node --version` → must be v20+ |
| **Git** | Clone the repo. | `git --version` |

---

## 2. Clone & enter the app folder

```bash
git clone <REPO_URL>
cd <repo>/MKTAgent
```

Everything below runs from `MKTAgent/`.

---

## 3. Start the backend + database

The backend and Postgres run in Docker. On startup Docker builds the image and
**applies database migrations automatically** — you don't run migrations by hand.

**a.** Create the env file:

```bash
cp .env.example .env
```

**b.** Generate the two secrets the app needs to boot, and paste each printed
line into the matching blank in `.env`:

```bash
node -e "console.log('TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET='   + require('crypto').randomBytes(48).toString('hex'))"
```

> These are just local encryption/session keys generated on your own machine —
> **not** third-party API keys. Every other value in `.env` can stay blank for now.

**c.** Bring it up:

```bash
docker compose up -d --build
```

**d.** Confirm it's healthy (returns JSON, not a connection error):

```bash
curl http://localhost:7100/health
```

---

## 4. Start the web UI

In a **second terminal** (leave the backend running):

```bash
cd MKTAgent/web
cp .env.example .env      # already points at the backend on :7100 — no edits needed
npm install
npm run dev
```

Open **<http://localhost:5173>**.

You should see the **AgentPortal** sidebar (Orchestrate · Flows · Campaigns ·
Posts · Connections). Click **Orchestrate** and type a goal to see the agent plan
a flow.

---

## 5. First thing to try

1. Open **Orchestrate**.
2. Type something like: *"Plan a branding campaign for a small coffee shop."*
3. The agent asks a couple of clarifying questions, then proposes a plan/flow.
4. Approve it and watch the agent nodes run live (status animates over SSE).

> The UI works fully without any API key, but the agent won't produce **real AI
> copy** until you add a free Gemini key — see the next section.

---

## 6. Set up your Gemini API key (recommended)

The Orchestrate agent uses **Google Gemini** to write real marketing copy. It's
**optional** — the app boots and is fully navigable without it — but with no key
the AI steps fall back to placeholder output. Google offers a **free tier**, so
this takes ~2 minutes and $0.

**a. Get the key** (do this first — it's not in the repo and can't be):

1. Go to **Google AI Studio → API keys**: <https://aistudio.google.com/apikey>
2. Sign in with any Google account.
3. Click **Create API key** (choose "Create in new project" if asked).
4. Copy the key — it looks like `AIza...`.

**b. Put it in your env file** (the `.env` you created in §3 — this file stays on
your machine and is never committed to git):

Open `MKTAgent/.env` and fill in the line:

```dotenv
GEMINI_API_KEY=AIza...your-key-here...
```

**c. Restart the backend so it picks up the key:**

```bash
cd MKTAgent
docker compose up -d      # recreates the app container with the new env
```

Now re-run an Orchestrate flow (§5) — the copywriter agent produces real text.

> **Never commit your key.** `MKTAgent/.env` is already git-ignored; keep it that
> way. If a key ever leaks, revoke it in AI Studio and create a new one.

---

## 7. What needs keys vs. what doesn't

| You want to… | Requires |
|--------------|----------|
| Boot the app, browse UI, create/edit Flows · Campaigns · Posts | **Nothing** beyond §3's two generated secrets |
| Real AI copy generation + the Orchestrate agent producing content | `GEMINI_API_KEY` |
| Real image generation on posts | image-gen API key |
| **Live publish** to Facebook / Instagram / Threads / LinkedIn / X | that platform's `MKT_*` tokens (via the Connections panel) |
| Google Drive / Sheets / Google login | `GOOGLE_*` values |

> **Getting social/API tokens is out of scope for this guide.** The portal is
> fully explorable without them — add keys later only for live output.

---

## 8. Ports

| Service | URL / Port |
|---------|-----------|
| Web UI | http://localhost:5173 |
| Backend API | http://localhost:7100 |
| Postgres | localhost:5433 |

Conflicts? Stop whatever owns the port, or change the mapping in
`MKTAgent/docker-compose.yml` (backend/DB) or `MKTAgent/web/vite.config.ts` (UI).

---

## 9. Everyday commands

```bash
# from MKTAgent/
docker compose logs -f app     # tail backend logs
docker compose up -d --build   # rebuild after pulling new code
docker compose down            # stop (keeps your data)
docker compose down -v         # stop AND wipe the database
```

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `curl :7100/health` connection refused | Docker Desktop not running, or the image is still building — `docker compose logs -f app`. |
| UI loads but every action errors | Backend not up, or `web/.env` `VITE_API_BASE` isn't `http://localhost:7100`. |
| `docker compose up` fails immediately | You're not in `MKTAgent/`, or Docker Desktop hasn't finished starting. |
| Port 5433 / 7100 / 5173 already in use | Another process owns it — stop it or change the port mapping. |
| Orchestrate runs but produces no real copy/images | No `GEMINI_API_KEY` in `MKTAgent/.env` (expected — see §5). |
| Backend restarts in a loop | Check `docker compose logs -f app` — usually a bad/missing value in `.env`. |
