# OAuth Setup — YouTube + Facebook (one-time, ~45 min)

This is the **only manual step** in the entire video-content-farm pipeline. Both platforms require operator interaction once; after that, n8n holds the credentials and refreshes them automatically (FB token refresh job lives in Phase 11).

## 1. YouTube Data API v3 (~20 min)

### 1.1 Google Cloud project

1. Go to <https://console.cloud.google.com> → **New project** → name it `video-content-farm` (any name OK)
2. **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**
3. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `videofarm-uploader`
   - User support + developer email: your email
   - Scopes: add `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`
   - Test users: add your Google account (the one with target YouTube channel)
   - Publishing status: leave in **Testing** mode (no need to verify)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Download the JSON → keep handy

### 1.2 n8n credential

1. Open n8n: <http://localhost:5678>
2. **Credentials → New → YouTube OAuth2 API**
3. Paste `client_id` and `client_secret` from the downloaded JSON
4. Click **Connect my account** → sign in with the Google account that owns the target channel → grant permissions
5. Save credential as **YouTube OAuth2**

### 1.3 Smoke test

- Open the `upload-to-platforms` workflow → YouTube node → **Execute node** with sample input
- Or use a temp workflow with `Resource: Video, Operation: List my videos` → should return your channel's recent videos

### 1.4 Quota note

- YT Data API daily quota: **10 000 units**, upload costs **1 600 units/video** → max ~6 uploads/day
- At 1-3 videos/day across 3 pipelines, we use ~60-90% of quota → fine

---

## 2. Facebook Reels Graph API (~20 min)

### 2.1 Facebook app

1. <https://developers.facebook.com/apps> → **Create app** → type **Business**
2. App name: `videofarm-uploader`
3. **App settings → Basic** — copy **App ID** + **App secret**
4. **Add products:**
   - Pages API
   - (optional) Facebook Login for Business

### 2.2 Page Access Token (long-lived, 60 days)

1. <https://developers.facebook.com/tools/explorer>
2. Top-right: select your app
3. **Permissions:** add `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`
4. **Generate Access Token** → grant scopes → get a **short-lived user token**
5. Exchange to long-lived user token:
   ```bash
   curl -G "https://graph.facebook.com/v18.0/oauth/access_token" \
     -d "grant_type=fb_exchange_token" \
     -d "client_id=YOUR_APP_ID" \
     -d "client_secret=YOUR_APP_SECRET" \
     -d "fb_exchange_token=SHORT_LIVED_USER_TOKEN"
   ```
6. Get target Page's access token (this is the **long-lived 60-day Page token**):
   ```bash
   curl -G "https://graph.facebook.com/v18.0/me/accounts" \
     -d "access_token=LONG_LIVED_USER_TOKEN"
   ```
7. From response, copy `access_token` of your target Page and the **Page ID** (`id` field)

### 2.3 Wire into `.env`

```dotenv
FB_PAGE_ID=<page id from step 2.2.7>
FB_PAGE_ACCESS_TOKEN=<page access_token from step 2.2.7>
```

### 2.4 Smoke test

```bash
curl -G "https://graph.facebook.com/v18.0/$FB_PAGE_ID" \
  -d "access_token=$FB_PAGE_ACCESS_TOKEN" \
  -d "fields=name,id"
```
→ should return `{ "name": "<your page>", "id": "<page id>" }`

### 2.5 Reels publish flow (already wired in `upload-to-platforms.json`)

3 calls:
1. `POST /{page_id}/video_reels?upload_phase=start` → returns `{ video_id, upload_url }`
2. `POST {upload_url}` with `Authorization: OAuth {token}` + `file_url: ...` → uploads binary
3. `POST /{page_id}/video_reels?upload_phase=finish&video_state=PUBLISHED&...` → publishes

---

## 3. Postgres credential in n8n

Required by **both** workflows (writes to `video_job`, `upload_target`, `run_log`).

1. **Credentials → New → Postgres**
2. Host: `postgres` (Docker service name)
3. Database: `videofarm`
4. User: `videofarm`
5. Password: value of `POSTGRES_PASSWORD` from `.env`
6. Port: `5432`
7. SSL: **disable**
8. Save as **Videofarm Postgres**

---

## 4. Import workflows

```bash
docker compose cp n8n-workflows/upload-to-platforms.json n8n:/tmp/upload-to-platforms.json
docker compose cp n8n-workflows/quiz-pipeline.json n8n:/tmp/quiz-pipeline.json
docker compose exec n8n n8n import:workflow --input=/tmp/upload-to-platforms.json
docker compose exec n8n n8n import:workflow --input=/tmp/quiz-pipeline.json
```

After import:
1. Open each workflow in n8n UI
2. **Re-bind credentials** (n8n imports lose credential references) — set Postgres, YouTube, and Facebook env-based references to your saved credentials
3. **Activate** `quiz-pipeline` workflow

---

## 5. Token expiry monitoring

| Credential | Expires | Refresh |
|---|---|---|
| YouTube OAuth2 | refresh-token never (unless revoked) | n8n auto-refreshes access token |
| Facebook Page Token | **60 days** | Phase 11 wires weekly refresh cron + alert at T-7 days |

Mark today's date — set a calendar reminder for **T-7 days** before FB token expiry until Phase 11 ships the auto-refresh job.
