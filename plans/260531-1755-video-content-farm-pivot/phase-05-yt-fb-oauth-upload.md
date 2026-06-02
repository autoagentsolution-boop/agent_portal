# Phase 05 — YouTube + Facebook OAuth + Upload Sub-Workflow

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-04](phase-04-quiz-pipeline-n8n.md)
- YT Data API v3: https://developers.google.com/youtube/v3/guides/uploading_a_video
- FB Reels API: https://developers.facebook.com/docs/video-api/guides/reels-publishing

## Overview
- **Priority:** Critical (M1 blocked nếu không upload được)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** Setup OAuth credentials trong n8n cho YT + FB. Tạo sub-workflow `upload-to-platforms` re-usable: input `{ jobId, videoPath, title, description, tags }` → upload cả 2 platforms → update `upload_target` rows.

## Key Insights
- **YT OAuth pain**: cần Google Cloud project → YouTube Data API enable → OAuth consent screen → desktop app credentials. ~30 min setup 1 lần
- **FB Page token**: long-lived 60d via `/oauth/access_token?grant_type=fb_exchange_token`. Phase 11 wire refresh job
- **n8n YouTube node** built-in — chỉ cần OAuth2 credential config
- **n8n KHÔNG có FB Reels node**, dùng HTTP Request đến Graph API
- **FB Reels 3-step upload**: (1) init upload → upload_id (2) PUT binary → (3) finish + publish

## Requirements

### Functional
- n8n có 2 credentials lưu:
  - `youtube-oauth2` (Google OAuth2 API credential)
  - `facebook-page-token` (HTTP Header Auth with `Bearer {token}`)
- Sub-workflow `upload-to-platforms`:
  - Input: `{ jobId, videoPath, title, description, tags[], thumbnailPath? }`
  - YT branch: upload mp4 as Short (use `#Shorts` in title/desc), set privacy=public, category=22 (People & Blogs) hoặc 24 (Entertainment) — config per pipeline
  - FB branch: 3-step Reels publish
  - Both: INSERT `upload_target` per platform với external_id + url
  - Parallel execution (YT và FB independent)
  - On platform fail: log lỗi, mark THAT platform failed, KHÔNG fail toàn workflow
- Wire vào quiz-pipeline (Phase 04): sau khi render xong → call sub-workflow

### Non-functional
- Re-runnable: nếu upload failed, có thể trigger lại sub-workflow với cùng jobId
- YT upload quota check: trước upload, check daily quota counter
- File size limit: YT 256GB / FB 4GB — chunk nếu > 100MB (n/a ở volume này, 60-90s clip < 30MB)

## Architecture

```
n8n-workflows/
├── quiz-pipeline.json
└── upload-to-platforms.json    # sub-workflow

[Main workflow] → [Execute Sub-Workflow: upload-to-platforms]
                                    ↓
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
           [YouTube Node]                  [FB HTTP: init upload]
                  ↓                                   ↓
           [Postgres INSERT                  [HTTP: PUT binary]
            upload_target YT]                        ↓
                                            [HTTP: finish publish]
                                                     ↓
                                            [Postgres INSERT upload_target FB]
```

## Sub-Workflow API Contract

```yaml
trigger: Execute Workflow Trigger
input:
  jobId: string
  videoPath: string             # relative to render-service output dir
  title: string                 # max 100 chars YT, 255 FB
  description: string
  tags: string[]                # YT only
  thumbnailPath: string?
  ytCategoryId: string?         # default '22'
output:
  ytUrl: string?
  ytExternalId: string?
  fbUrl: string?
  fbExternalId: string?
  errors: { youtube?: string, facebook?: string }
```

## Related Code Files
- **Create:** `n8n-workflows/upload-to-platforms.json`
- **Modify:** `n8n-workflows/quiz-pipeline.json` (add Execute Sub-Workflow node before final DB update)
- **Create:** `docs/oauth-setup.md` (step-by-step cho operator)
- **Update:** `.env.example` thêm YT OAuth credentials, FB Page ID + token

## Implementation Steps

### YT OAuth Setup (manual, một lần)
1. Google Cloud Console → tạo project `video-content-farm`
2. Enable "YouTube Data API v3"
3. OAuth consent screen → External → add scope `youtube.upload`, `youtube.readonly`
4. Credentials → OAuth client ID → Desktop app → download JSON
5. Trong n8n: Credentials → New → YouTube OAuth2 API → paste client ID + secret → Connect → authorize với YT channel target
6. Test: n8n YouTube node → "Get my videos" → must return data

### FB Page Setup (manual, một lần)
1. developers.facebook.com → tạo app type "Business"
2. Add product "Facebook Login for Business" + "Pages API"
3. Get user access token → exchange to long-lived: `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...`
4. Get Page ID + Page Access Token: `GET /me/accounts` → save `access_token` của target page
5. Trong n8n: Credentials → New → HTTP Header Auth → name `Authorization`, value `Bearer {token}` (KHÔNG raw token)
6. Test: `curl -G "https://graph.facebook.com/v18.0/{page_id}" -d "access_token={token}"` → 200

### Sub-Workflow Build
1. n8n → New Workflow → "Execute Workflow Trigger" node với input schema
2. Split branches (Merge later):

**YT branch:**
- YouTube node: Resource=Video, Operation=Upload
  - Binary data: read file from render-service shared volume hoặc fetch qua `/files/:filename`
  - Title: `{{$json.title}} #Shorts`
  - Description: `{{$json.description}}\n\n#Shorts #YouTubeShorts`
  - Tags: from input array
  - Privacy: public
  - CategoryId: from input or default '22'
- Postgres: INSERT upload_target

**FB branch (HTTP nodes):**
- HTTP #1: `POST /{page_id}/video_reels?upload_phase=start&access_token={{$credential}}` → response has `video_id`, `upload_url`
- HTTP #2: `POST {upload_url}` with header `Authorization: OAuth {token}`, `file_url: ...` OR raw binary
- HTTP #3: `POST /{page_id}/video_reels?upload_phase=finish&video_id={...}&video_state=PUBLISHED&description=...`
- Postgres: INSERT upload_target

**Merge** branches → return outputs

### Quiz Pipeline Wire-Up
1. Sau render success node, add **Execute Workflow** node → workflow=`upload-to-platforms`, pass `{jobId, videoPath, title=quiz title, description, tags=[niche]}`
2. After upload: update `video_job.status='published'` (or `partial` if 1 platform failed)
3. Export updated quiz-pipeline.json

## Todo List
- [ ] Google Cloud project + YT Data API enable
- [ ] OAuth consent + desktop credentials
- [ ] n8n YouTube OAuth2 credential connected, smoke test
- [ ] FB app + long-lived Page token
- [ ] n8n FB HTTP Header credential
- [ ] Test FB API call standalone (curl)
- [ ] Build sub-workflow `upload-to-platforms` (2 branches)
- [ ] Wire quiz-pipeline to sub-workflow
- [ ] Manual trigger E2E: 1 quiz video → uploaded YT + FB
- [ ] Export both workflow JSONs
- [ ] Document OAuth steps trong `docs/oauth-setup.md`

## Success Criteria
- 1 video upload thành công lên cả YT Shorts và FB Reels
- `upload_target` có 2 rows (YT, FB) cho jobId, status=uploaded, url filled
- Sub-workflow re-runnable: pass same input → both platforms re-upload (sẽ tạo duplicate, OK ở dev)
- 1 platform fail không kill toàn workflow

## Risk Assessment
- **Risk:** YT bị reject vì missing #Shorts tag → **Mitigation:** Append `#Shorts` always, verify vertical aspect
- **Risk:** FB Reels API trả `Permissions error` → **Mitigation:** Verify Page token có scope `pages_manage_posts` + `pages_read_engagement`
- **Risk:** YT quota 1600 units/upload → 6 upload/ngày max — đủ cho 3 video/day × 1 platform, nhưng nếu 2 channels thì cận → **Mitigation:** Phase 11 monitor
- **Risk:** FB token leak via n8n export JSON → **Mitigation:** n8n credentials lưu encrypted; JSON export STRIP credentials by default (verify trước commit)

## Security Considerations
- KHÔNG commit `.env` chứa token; commit `.env.example` placeholder only
- Sub-workflow input validation: title length, description length, jobId UUID format
- Postgres connection từ n8n: dùng dedicated user `n8n_app` với INSERT/UPDATE-only grant (no DELETE/DROP)

## Next Steps
→ Phase 06: E2E milestone — 7 ngày liên tiếp quiz pipeline tự động không touch
