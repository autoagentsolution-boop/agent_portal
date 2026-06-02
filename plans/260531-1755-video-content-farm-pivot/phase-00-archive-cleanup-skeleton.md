# Phase 00 — Archive Old Portal + Fresh Skeleton

## Context Links
- Plan: [plan.md](plan.md)
- Brainstorm: `plans/reports/brainstorm-260531-1755-video-content-farm-pivot.md`
- Superseded plans: `260504-1847-agent-portal-demo`, `260506-1435-gmail-classifier-api-workflow`, `260511-1252-prisma-cjs-cleanup`

## Overview
- **Priority:** Critical (blocks all subsequent phases)
- **Status:** pending
- **Effort:** 0.5 day
- **Brief:** Archive old AgentPortal code (NestJS + frontend + Better Auth) sau git tag, giữ docker-compose pattern + n8n volume, tạo fresh repo skeleton cho videofarm.

## Key Insights
- Old portal có 100+ files trong `backend/` và `frontend/` không tái dùng được — pivot khác nature hoàn toàn
- Giữ git history qua tag `archive/agent-portal-demo` → có thể checkout cũ nếu cần reference
- n8n volume (`n8n_data` trong docker compose) có thể giữ workflows cũ làm reference, nhưng database thì wipe (schema mismatch)

## Requirements

### Functional
- Tag git commit hiện tại (`4a954af`) là `archive/agent-portal-demo` và push tag lên local (no remote)
- Xóa `backend/`, `frontend/`, root spec docs cũ (`DEMO_2WEEK_PLAN.md`, `agent_operations_portal_local_demo_spec.md`)
- Giữ: `docker-compose.yml` (rewrite), `.gitignore`, `.claude/`, `docs/` (sẽ refactor sau)
- Tạo skeleton:
  - `render-service/` (Node + Remotion service)
  - `n8n-workflows/` (workflow JSON exports)
  - `db/migrations/` (raw SQL hoặc Prisma schema)
  - `scripts/` (helper CLI)
  - `.env.example` (Gemini key, Pexels key, FB token, YT OAuth)
  - `README.md` (quickstart, stack overview)

### Non-functional
- `docker compose up` không error sau Phase 00 (services tối thiểu: postgres, n8n)
- Repo root clean, dưới 15 top-level items

## Architecture (target tree)
```
AgentPortal/                        # giữ tên repo
├── .claude/                        # giữ
├── .env.example
├── docker-compose.yml              # rewrite
├── README.md                       # rewrite
├── db/
│   └── migrations/                 # Phase 01 fills
├── render-service/                 # Phase 02 fills
├── n8n-workflows/                  # Phase 04+ fills
├── scripts/                        # Phase 10 fills
├── docs/                           # rewrite minimal
└── plans/                          # giữ
```

## Related Code Files
- **Delete:** `backend/`, `frontend/`, `DEMO_2WEEK_PLAN.md`, `agent_operations_portal_local_demo_spec.md`, `n8n-workflows/` cũ (move sang `archive-branch` git tag, không cần giữ workspace)
- **Modify:** `docker-compose.yml`, `README.md`, `.gitignore`, `.env.example`
- **Create:** `render-service/package.json`, `render-service/Dockerfile`, skeleton dirs

## Implementation Steps
1. `git tag archive/agent-portal-demo` trên HEAD hiện tại
2. `git checkout -b pivot/video-content-farm`
3. `git rm -r backend frontend DEMO_2WEEK_PLAN.md agent_operations_portal_local_demo_spec.md n8n-workflows/*.json`
4. Rewrite `docker-compose.yml`:
   - services: `postgres` (5432), `n8n` (5678), `render-service` (7000)
   - Bind-mount cảnh báo: render-service nên KHÔNG bind-mount source → bake at build (giữ contract cũ)
5. Tạo `.env.example` với keys:
   ```
   GEMINI_API_KEY=
   PEXELS_API_KEY=
   PIXABAY_API_KEY=
   YT_OAUTH_CLIENT_ID=
   YT_OAUTH_CLIENT_SECRET=
   FB_PAGE_ID=
   FB_PAGE_ACCESS_TOKEN=
   N8N_BASIC_AUTH_USER=admin
   N8N_BASIC_AUTH_PASSWORD=
   POSTGRES_DB=videofarm
   POSTGRES_USER=videofarm
   POSTGRES_PASSWORD=
   ```
6. Tạo `render-service/` skeleton (chỉ scaffold dirs, code Phase 02)
7. Wipe Postgres volume cũ (nếu có): `docker compose down -v`
8. Smoke: `docker compose up -d postgres n8n` → check 2 containers healthy
9. Commit: `chore(pivot): archive old portal, fresh skeleton`

## Todo List
- [ ] Tag `archive/agent-portal-demo` trên `4a954af`
- [ ] New branch `pivot/video-content-farm`
- [ ] Delete old code dirs
- [ ] Rewrite `docker-compose.yml` (3 services)
- [ ] Create `.env.example` with all keys
- [ ] Create skeleton dirs (`render-service/`, `db/`, `scripts/`)
- [ ] Wipe old postgres volume
- [ ] `docker compose up -d postgres n8n` smoke
- [ ] Commit

## Success Criteria
- Old code gone từ working tree, vẫn restore được qua `git checkout archive/agent-portal-demo`
- `docker compose up -d postgres n8n` healthy
- Repo root ≤ 15 items
- Old plan markers updated (note "superseded" trong plan.md cũ — tuỳ chọn, không bắt buộc)

## Risk Assessment
- **Risk:** Lỡ delete file cần thiết (vd: `.claude/` config) → **Mitigation:** Dry-run với `git status` sau mỗi `rm -r` trước commit
- **Risk:** Postgres volume cũ chứa data quan trọng → **Mitigation:** Demo data only, confirmed safe to wipe

## Security Considerations
- `.env.example` chỉ chứa key names, KHÔNG actual values
- `.env` (real) phải vào `.gitignore` (kiểm tra)
- `archive/agent-portal-demo` tag chứa user data demo (test users) → repo local-only, OK

## Next Steps
→ Phase 01: Postgres schema + Prisma client
