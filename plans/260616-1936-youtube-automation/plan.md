---
title: "YouTube Auto-Publish Pipeline — n8n Inbox Watcher"
description: "n8n picks up user-curated dish bundles, renders via storyboard v2 pipeline, uploads to YouTube as private, emails review link. Cron Tue + Fri 9am Asia/Bangkok."
status: pending
priority: P2
effort: ~16h total
branch: pivot/video-content-farm
tags: [n8n, youtube, automation, oauth, pipeline]
created: 2026-06-16
---

# YouTube Auto-Publish Pipeline

## Goal

Mỗi tuần 2 video. User (15-30 phút/ngày) dùng ChatGPT v3 prompt tạo bundle folder. n8n local cron Thứ 3 + Thứ 6 9am Asia/Bangkok:

1. Watch `inbox/` directory
2. Pick oldest unprocessed folder
3. Validate folder integrity (storyboard.json + 9-14 panel PNGs + metadata.yaml)
4. Run `scripts/run-storyboard-v2.ts <folder>/storyboard.json --images-dir=<folder>/panels --out=<folder>/output.mp4`
5. Upload to YouTube `privacyStatus: private` with metadata.yaml fields
6. Email user with YouTube studio link to review + 1-click publish
7. Move folder to `inbox/_done/<date-slug>/`

## Non-goals

- Auto-publish (always private first — user manually flips after review)
- Auto-generate storyboard (user-curated via ChatGPT)
- Multi-channel (single YouTube channel for MVP)
- Auto-thumbnail (use panel-01.png by default; only custom if `thumbnail.png` present in folder)

## Cost model

| Item | Per video | 8 videos/month |
|------|-----------|----------------|
| TTS (Azure Edge) | $0.06 | $0.48 |
| Veo Lite × ~12 panels | $0.60 | $4.80 |
| YouTube upload | $0 (quota) | $0 |
| Email (SMTP) | $0 | $0 |
| **Total** | **$0.66** | **~$5.28/month** |

Cache hits (re-runs after edits): $0.

## Phase Progress

| # | Phase | Status | Effort | Key files |
|---|-------|--------|--------|-----------|
| 01 | [ChatGPT v3 prompt + folder convention](phase-01-chatgpt-prompt-v3.md) | ✅ DONE | 1h | `plans/260616-1319-storyboard-v2/prompts/chatgpt-storyboard-v3-automation.md` |
| 02 | [Inbox watcher script + validation](phase-02-inbox-watcher.md) | pending | 4h | `scripts/process-inbox.ts`, validation against storyboard schema + folder integrity |
| 03 | [YouTube OAuth + uploader](phase-03-youtube-uploader.md) | pending | 6h | `render-service/src/youtube/upload.ts`, OAuth refresh, DB column `ytVideoId` |
| 04 | [Email notification](phase-04-email-notify.md) | pending | 2h | `render-service/src/notify/email.ts`, SMTP or Resend/SendGrid |
| 05 | [n8n workflow JSON](phase-05-n8n-workflow.md) | pending | 3h | `n8n/workflows/youtube-auto-publish.json`, schedule + secret mgmt |

## High-level architecture

```
[ChatGPT Plus] (user, 15-30min/day)
      ↓ output 12 images + JSON + YAML
[inbox/<date>-<slug>/]                    ← user drops here
      ↓
[n8n cron Tue 9am + Fri 9am]
      ↓
[1] Execute Command node → scripts/process-inbox.ts pick oldest folder
      ↓ {folderPath, dishName, dishSlug}
[2] Validate bundle → return {ok: true|false, issues: [...]}
      ↓ if !ok: notify + move to inbox/_error/
[3] Execute Command → scripts/run-storyboard-v2.ts <folderPath>/storyboard.json --images-dir=<folderPath>/panels --out=<folderPath>/output.mp4
      ↓ {mp4Path, costUsd, jobId}
[4] Read metadata.yaml → parse fields
      ↓
[5] HTTP node → YouTube Data API v3 videos.insert (private)
      ↓ {ytVideoId, ytStudioUrl}
[6] DB insert into video_publish table {jobId, dishSlug, ytVideoId, status: "review_pending", uploadedAt}
      ↓
[7] Email node (SMTP) → "Bún Chả ready for review: <ytStudioUrl>"
      ↓
[8] Move folder inbox/<date>-<slug>/ → inbox/_done/<date>-<slug>/

Failure paths:
- Validation fails → inbox/_error/ + notify
- Render fails → keep folder in inbox/, notify, n8n retries next cron OR manual rerun
- YouTube fails (quota/auth) → keep mp4, notify, n8n retries next cron
- Email fails → log only (non-critical)
```

## Folder convention (user → n8n)

```
inbox/
  20260617-bun-cha/                 ← user creates this folder
    storyboard.json                 ← schema-v2 JSON (validated by Zod)
    metadata.yaml                   ← YouTube title/desc/tags
    panels/
      panel-01.png ... panel-NN.png ← 9-14 images, 1080×1920 PNG
    thumbnail.png                   ← OPTIONAL custom 1280×720
    README.md                       ← OPTIONAL user notes (ignored)
    .processing                     ← n8n creates this when claimed (lock file)
    output.mp4                      ← n8n writes after render
  _done/
    20260615-bo-kho/                ← n8n moves here after YouTube upload
  _error/
    20260616-broken-bundle/         ← n8n moves here if validation fails
```

Lock file `.processing` prevents double-claim if n8n cron overlaps. Cleanup: any `.processing` older than 2h = stale, n8n removes + retries.

## DB schema additions

Add to existing `db/prisma/schema.prisma`:

```prisma
enum VideoPublishStatus {
  pending
  rendering
  uploading
  review_pending     // uploaded private, awaiting user manual flip
  published
  failed
}

model VideoPublish {
  id                String              @id @default(cuid())
  jobId             String              @unique  // FK to existing VideoJob.id
  dishSlug          String
  inboxPath         String              // e.g. "inbox/20260617-bun-cha"
  outputMp4Path     String?
  ytVideoId         String?             // youtube video ID after upload
  ytPrivacyStatus   String?             // private | unlisted | public
  status            VideoPublishStatus  @default(pending)
  errorMessage      String?
  costUsd           Decimal?            @db.Decimal(10, 4)
  createdAt         DateTime            @default(now())
  uploadedAt        DateTime?
  publishedAt       DateTime?
}

model YoutubeOauth {
  id                String              @id @default(cuid())
  channelId         String              @unique
  accessToken       String              // ENCRYPTED via pgcrypto or app-layer AES
  refreshToken      String              // ENCRYPTED
  expiresAt         DateTime
  scopes            String              // space-separated
  updatedAt         DateTime            @updatedAt
}
```

Migration: `npx prisma migrate dev --name add_youtube_publish`.

## YouTube OAuth flow

1. **One-time setup**: user runs `npx tsx scripts/youtube-auth-setup.ts`:
   - Spawns local HTTP server on `localhost:7878` for OAuth callback
   - Opens browser to Google OAuth consent (scope: `youtube.upload`)
   - User logs in with channel-owning Google account
   - Captures `code` → exchanges for `access_token` + `refresh_token`
   - Persists to `YoutubeOauth` table (encrypted)
2. **Refresh logic**: before each upload, check `expiresAt`. If <5 min remaining, call `refresh_token` endpoint, update DB.
3. **Failure recovery**: 401 from upload → force refresh once → retry. 401 again → mark token invalid, alert user to re-auth.

Reference: Google's `googleapis` npm package handles refresh automatically if you pass refresh token.

## Idempotency strategy

- **Folder marker**: `.processing` lockfile timestamped. Stale (>2h) = retry-eligible.
- **DB row**: insert `VideoPublish` row with `status: rendering` BEFORE any work. Resume = update status. Two cron runs see existing row → skip.
- **Asset cache**: existing `getOrCompute` makes re-render free. Veo + TTS + music all cached.
- **YouTube upload**: track `ytVideoId` in row. If row already has `ytVideoId`, skip upload (already done).

## Email notification

Template (Vietnamese):
```
Subject: 🎬 Video [Bún Chả Hà Nội] đã sẵn sàng để review

Chào bạn,

Pipeline đã render xong video "Bún Chả Hà Nội" và upload lên YouTube với chế độ Private.

Thông tin:
- Dish: Bún Chả Hà Nội
- Duration: 69s
- Cost: $0.66
- YouTube Studio link: https://studio.youtube.com/video/{ytVideoId}/edit
- YouTube watch link: https://youtu.be/{ytVideoId}

Hành động cần làm:
1. Xem video trên YouTube Studio
2. Nếu OK → click "Save" → đổi Visibility thành "Public"
3. Nếu cần fix → reply email này, mình sẽ xoá folder để bạn re-bundle

Folder bundle đã được archive tại: inbox/_done/20260617-bun-cha/
```

SMTP options: Gmail SMTP (cần app password) hoặc Resend / Mailgun free tier.

## Security implications

| Concern | Mitigation |
|---------|-----------|
| OAuth refresh token = full upload power on channel | Encrypt at rest (pgcrypto). Never log. Don't commit. |
| n8n credentials store | n8n encrypts by default w/ `N8N_ENCRYPTION_KEY` — set strong key in `.env`, backup separately |
| Local inbox folder = file-system access | n8n runs as user `vincere`, restrict folder perms to that user |
| YouTube API key leak | Use OAuth refresh token (per-channel), NOT API key. Refresh tokens revocable per-channel from Google Account settings |
| Email contains YouTube link | Acceptable since video is private — only channel owner can view via Studio link |
| Cost overrun (Veo runaway) | Existing `COST_CAP_USD` env gate + `MAX_DAILY_COST_USD` preflight |

## Operational concerns

- **n8n schedule**: cron `0 9 * * 2,5` (Tuesday + Friday 9am). Timezone via `TZ=Asia/Bangkok` env on n8n container.
- **Monitoring**: n8n exposes execution history UI at `localhost:5678`. Add Slack/email alert on workflow failure.
- **Backup**: nightly `pg_dump` for `YoutubeOauth` + `VideoPublish` tables. Already covered by `scripts/backup-db.sh`.
- **n8n version**: pin to known-stable (`n8nio/n8n:1.x` not `latest`). Already in `docker-compose.yml`.
- **Logs**: pipeline logs to JSON stdout → captured by n8n execution log. Also `tee` to `out/<dishSlug>-run.log` for greppable history.

## Decisions chốt 2026-06-16

- **Email service**: Gmail SMTP (free, app password trong `.env`)
- **OAuth setup**: n8n credentials UI (n8n có sẵn Google OAuth helper, mã hoá tự động bằng `N8N_ENCRYPTION_KEY` — không cần custom script. Bypass `YoutubeOauth` table — n8n manages tokens internally)
- **Resume order**: stop coding sau plan. User test ChatGPT v3 prompt với Bún Chả trước. Nếu prompt OK → next session code phase 02+03.

## Updated DB schema (post-decision)

`YoutubeOauth` table KHÔNG cần — n8n manages OAuth. Chỉ giữ `VideoPublish`:

```prisma
enum VideoPublishStatus {
  pending
  rendering
  uploading
  review_pending
  published
  failed
}

model VideoPublish {
  id                String              @id @default(cuid())
  jobId             String              @unique
  dishSlug          String
  inboxPath         String
  outputMp4Path     String?
  ytVideoId         String?
  ytPrivacyStatus   String?
  status            VideoPublishStatus  @default(pending)
  errorMessage      String?
  costUsd           Decimal?            @db.Decimal(10, 4)
  createdAt         DateTime            @default(now())
  uploadedAt        DateTime?
  publishedAt       DateTime?
}
```

## Remaining open questions

1. **n8n credentials backup**: include `N8N_ENCRYPTION_KEY` trong `pg_dump` backup hay vault riêng? — defer to phase 05
2. **Failure alerts**: Slack hay Telegram cho operational errors? — defer
3. **Multi-channel**: 1 channel duy nhất, hoặc multi-channel ready từ schema? — defer

## References

- ChatGPT v3 prompt: `plans/260616-1319-storyboard-v2/prompts/chatgpt-storyboard-v3-automation.md`
- Existing v2 CLI: `scripts/run-storyboard-v2.ts`
- YouTube Data API v3: https://developers.google.com/youtube/v3/docs/videos/insert
- n8n docs: https://docs.n8n.io
- Existing FB token refresh runbook (similar OAuth pattern): docs/runbook-cooking-pipeline.md (Phase 12)
- Memory entry: `project_storyboard_v2_pivot.md` (DONE 2026-06-16)
