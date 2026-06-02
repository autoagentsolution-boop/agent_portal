# Phase 01 — Postgres Schema + Prisma Client

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-00](phase-00-archive-cleanup-skeleton.md)

## Overview
- **Priority:** Critical (foundation cho mọi pipeline)
- **Status:** pending
- **Effort:** 0.5 day
- **Brief:** Schema design tối thiểu cho job tracking + asset cache + upload result. Prisma 7 (giữ familiarity), nhưng simpler than old portal (no auth/multitenancy).

## Key Insights
- Schema **compute-on-read** cho stats, không pre-aggregate (volume nhỏ)
- Idempotent asset cache (hash) giảm cost Nano Banana — critical
- `upload_target` tách khỏi `video_job` để 1 video upload nhiều platforms

## Requirements

### Functional
- `video_job`: orchestration record (1 row = 1 video plan)
- `asset`: cached generated content (images, audio, video) — keyed by hash(prompt + params)
- `upload_target`: per-platform result (yt_url, fb_url, status)
- `run_log`: chronological event log (free-form JSON detail, debug audit)

### Non-functional
- Migrations idempotent (run twice không lỗi)
- Indexes cho query patterns: jobs by status, assets by hash, recent logs

## Architecture

```sql
-- core orchestration
video_job (
  id UUID PK,
  pipeline TEXT,           -- 'quiz' | 'news_comic' | 'life_hacks'
  niche TEXT,
  status TEXT,             -- 'queued'|'generating'|'rendering'|'uploading'|'done'|'failed'
  script JSONB,            -- LLM output preserved
  video_path TEXT,         -- final mp4 path
  cost_usd NUMERIC(10,4),
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT
)

-- idempotent cache
asset (
  hash TEXT PK,            -- sha256(provider + prompt + params)
  kind TEXT,               -- 'image'|'audio'|'video_clip'
  provider TEXT,           -- 'nano_banana'|'edge_tts'|'pexels'|...
  path TEXT,               -- file path on disk
  bytes BIGINT,
  created_at TIMESTAMPTZ
)

-- per-platform upload outcome
upload_target (
  id UUID PK,
  job_id UUID FK → video_job.id ON DELETE CASCADE,
  platform TEXT,           -- 'youtube'|'facebook'
  status TEXT,             -- 'pending'|'uploaded'|'failed'
  external_id TEXT,        -- yt video id / fb video id
  url TEXT,
  uploaded_at TIMESTAMPTZ,
  error TEXT
)

-- audit log
run_log (
  id BIGSERIAL PK,
  job_id UUID FK → video_job.id ON DELETE CASCADE,
  level TEXT,              -- 'info'|'warn'|'error'
  step TEXT,               -- 'script'|'image'|'tts'|'render'|'upload'
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- indexes
CREATE INDEX ix_job_status ON video_job(status);
CREATE INDEX ix_job_pipeline_created ON video_job(pipeline, created_at DESC);
CREATE INDEX ix_asset_kind ON asset(kind);
CREATE INDEX ix_upload_job ON upload_target(job_id);
CREATE INDEX ix_log_job_created ON run_log(job_id, created_at DESC);
```

## Related Code Files
- **Create:** `db/prisma/schema.prisma`, `db/prisma/migrations/00_init/migration.sql`
- **Create:** `db/seed.ts` (optional — sample dev data)
- **Modify:** `docker-compose.yml` (mount migration runner if needed)

## Implementation Steps
1. `cd db && npm init -y && npm i -D prisma typescript ts-node && npx prisma init --datasource-provider postgresql`
2. Viết `schema.prisma` theo spec trên
3. `npx prisma migrate dev --name init` → tạo migration SQL
4. Optional: viết `seed.ts` insert 1-2 sample jobs cho dev
5. Compile check: `npx tsc --noEmit`
6. Wire vào docker-compose: add init container hoặc document manual `npx prisma migrate deploy`
7. Smoke: `psql videofarm -c "\dt"` → 4 tables

## Todo List
- [ ] `db/` package init với Prisma 7
- [ ] `schema.prisma` 4 models + indexes
- [ ] Migration generate + apply
- [ ] Seed script (optional)
- [ ] Smoke `\dt`
- [ ] Document migration command trong README

## Success Criteria
- 4 tables tồn tại trong DB với indexes đúng
- Prisma client generate được, import từ render-service không lỗi
- Migration apply idempotent

## Risk Assessment
- **Risk:** Prisma CJS issue tái xuất hiện (từ old portal) → **Mitigation:** Skip wrapping in NestJS, dùng Prisma trực tiếp trong render-service (Node ESM). Old portal Phase Prisma-CJS-Cleanup giờ obsolete.
- **Risk:** Asset hash collision → **Mitigation:** sha256 đủ rộng, không lo thực tế

## Security Considerations
- DB credentials qua env var only
- Không expose Postgres port ra ngoài Docker network (nếu deploy)
- `script`, `detail` JSONB không log PII (n/a — không có user data)

## Next Steps
→ Phase 02: render-service scaffold (Node + Remotion, import Prisma client từ đây)
