# Setup Guide — MKTAgent

> **This is the current app.** The stack lives in [`MKTAgent/`](MKTAgent/). The
> root `README.md` describes an older video-farm pipeline and is kept for
> reference only — follow **this** file to run the portal.

MKTAgent is a marketing-automation portal: an AI "Orchestrate" chat that plans
content flows, generates copy + images, and (optionally) publishes to social
platforms. Backend is TypeScript/Express + Postgres; the UI is React/Vite.

---

## 1. Prerequisites

Install these first:

| Tool | Notes |
|------|-------|
| **Docker Desktop** | Must be **running**. On Windows, enable the WSL2 backend. |
| **Node.js ≥ 20** | <https://nodejs.org> — needed for the web UI. |
| **Git** | To clone the repo. |

Check they work:

```bash
docker --version
node --version   # must print v20 or higher
```

---

## 2. Clone

```bash
git clone <REPO_URL>
cd <repo>/MKTAgent
```

---

## 3. Backend + database (Docker)

The backend and its Postgres run in Docker. Docker builds the app image and runs
database migrations automatically on start.

```bash
# from the MKTAgent/ folder
cp .env.example .env
```

Open `.env` and set the **two required secrets** (everything else can stay blank
to start — see §6). Generate them:

```bash
node -e "console.log('TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET='   + require('crypto').randomBytes(48).toString('hex'))"
```

Paste each printed line's value into the matching blank in `.env`
(`TOKEN_ENC_KEY=...` and `JWT_SECRET=...`).

Start it:

```bash
docker compose up -d --build
```

Verify the backend is alive (should return JSON):

```bash
curl http://localhost:7100/health
```

---

## 4. Web UI

Run the UI in a **separate terminal** — it is not containerised.

```bash
cd MKTAgent/web
cp .env.example .env      # default already points at the backend on :7100
npm install
npm run dev
```

Open **<http://localhost:5173>**.

---

## 5. Ports

| Service | URL / Port |
|---------|-----------|
| Web UI | http://localhost:5173 |
| Backend API | http://localhost:7100 |
| Postgres | localhost:5433 |

If a port is already in use, stop whatever owns it (or edit the port mapping in
`MKTAgent/docker-compose.yml` / `web/vite.config.ts`).

---

## 6. What works without any API keys

You can boot the portal and click around the whole UI with **just the two
generated secrets** from §3.

| Capability | What it needs |
|------------|---------------|
| App boots, UI loads, create/edit flows · campaigns · posts | Nothing beyond §3 |
| AI copy generation + the Orchestrate agent chat | `GEMINI_API_KEY` in `.env` |
| Live publishing (Facebook / Instagram / Threads / LinkedIn / X) | The platform's `MKT_*` tokens |
| Google Drive / Sheets / Google login | `GOOGLE_*` values |

> Obtaining social/API tokens is **out of scope for this guide** — the app runs
> and is fully explorable without them. Add them later only if you want live
> publishing.

---

## 7. Common commands

```bash
# stop everything (keeps the database volume)
docker compose down

# stop AND wipe the database
docker compose down -v

# view backend logs
docker compose logs -f app

# rebuild after pulling new code
docker compose up -d --build
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `curl :7100/health` refused | Docker Desktop not running, or image still building — check `docker compose logs -f app`. |
| UI loads but every request fails | Backend not up, or `web/.env` `VITE_API_BASE` doesn't point at `http://localhost:7100`. |
| Port 5433 / 7100 / 5173 in use | Another process owns it — stop it or change the port mapping. |
| `docker compose` build fails | Ensure you're in `MKTAgent/` (not repo root) and Docker Desktop has finished starting. |
