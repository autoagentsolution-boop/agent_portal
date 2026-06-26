# Marketing Pipeline — Hướng Dẫn Lấy Access Token (5 Nền Tảng, Step-by-Step)

> Tài liệu **thực thi từng bước** để lấy access token cho cả 5 nền: Facebook, Instagram, Threads,
> LinkedIn, X. Mọi bước đã **verified bằng post thật 2026-06-26**. Dùng cho cả việc tự setup lẫn hướng
> dẫn khách (mô hình bán per-install).

**Liên kết:** chi phí + use-case xem `marketing-platform-onboarding-guide.md` · verify token trước test xem
`marketing-test-preflight-checklist.md` · deploy env vào container xem `marketing-social-token-deployment.md`.

---

## Bản đồ token (đọc trước — mỗi nền 1 mô hình khác nhau)

| Nền | Token là gì | Sống bao lâu | Lấy ở đâu | Lưu vào |
|-----|-------------|--------------|-----------|---------|
| Facebook | Page token (từ System User) | **Vĩnh viễn** | Business Settings → System Users | `$env` (n8n-local/.env) |
| Instagram | **Dùng CHUNG token FB Page** | = FB (vĩnh viễn) | Không lấy riêng | `$env` (= FB page token) |
| Threads | Long-lived user token | **60 ngày** (refresh được) | App Dashboard → Threads | `$env` |
| LinkedIn | OAuth2 user token | **60 ngày** + refresh 365d | Token Generator | `$env` |
| X (Twitter) | OAuth2 user-context (PKCE) | **~2h** (auto-refresh) | n8n credential vault | **n8n vault** (KHÔNG $env) |

**Quy tắc vàng:** FB/IG/Threads/LinkedIn lưu `$env` (`n8n-local/.env`). X PHẢI lưu trong n8n credential vault
(token 2h, cần auto-refresh). Sau khi sửa `.env` → `docker compose up -d --force-recreate n8n` (KHÔNG restart).

---

## 1. FACEBOOK — Page token vĩnh viễn (KHÔNG cần App Secret)

**Nguyên tắc:** token phải đến từ **System User** (Business), KHÔNG phải Graph API Explorer (token đó chỉ
sống 1-2h → đây là nguồn gốc lỗi "token hết hạn" cả ngày).

### Chuẩn bị
- 1 Facebook Page (loại nào cũng được — endpoint publish giống nhau).
- 1 Meta Business (business.facebook.com) sở hữu Page.
- 1 Meta App (developers.facebook.com) loại Business.

### Các bước
1. **business.facebook.com** → Business Settings (⚙️) → **Users → System Users** → **Add**:
   - Tên: vd `Admin_MKT` · Role: **Admin**.
2. Chọn system user vừa tạo → **Add Assets** → Pages → chọn Page → bật **Manage Page** (full control).
3. Bấm **Generate New Token**:
   - Chọn App (Meta App của bạn).
   - Scopes tick: `pages_manage_posts` + `pages_show_list` + `pages_read_engagement`
     (nếu cũng đăng IG: thêm `instagram_basic` + `instagram_content_publish`).
   - Generate → **COPY token ngay** (chỉ hiện 1 lần). Đây là **page token vĩnh viễn**.
4. **Lấy Page ID:** Page → About → Page transparency → Page ID. Hoặc:
   ```bash
   curl -sG "https://graph.facebook.com/v25.0/me/accounts" \
     --data-urlencode "access_token=<SYSTEM_USER_TOKEN>"
   ```

### Verify (phải trả về CHÍNH PAGE, không phải user)
```bash
curl -sG "https://graph.facebook.com/v25.0/me" \
  --data-urlencode "fields=id,name" --data-urlencode "access_token=<PAGE_TOKEN>"
# OK = {"name":"<tên page>","id":"<page id>"}  ← name là tên PAGE
# SAI = trả về tên người → đang cầm system-user token, không phải page token
```

### Env
```
MKT_FB_PAGE_ID=<page id>
MKT_FB_PAGE_ACCESS_TOKEN=<page token vĩnh viễn>
```

### Bẫy
- ⚠️ **ĐỪNG xóa Meta App** → mọi token thành `code 190 "Application has been deleted"`.
- ⚠️ Token Graph API Explorer = short-lived, KHÔNG dùng. Chỉ System User cho token vĩnh viễn.
- ⚠️ Spam đăng nhiều bài từ app dev-mode → Meta tạm khóa (`code 200 "API access blocked"`), tự gỡ sau 24-48h.

---

## 2. INSTAGRAM — dùng CHUNG token Facebook Page (không lấy token riêng)

**Nguyên tắc:** IG đăng qua **graph.facebook.com/{IG_USER_ID}/media** bằng **chính token FB Page** (IG link
vào FB Page như `instagram_business_account`). KHÔNG dùng luồng Instagram-Login (IGAA/graph.instagram.com).

> ⚠️ **BẪY ĐÃ DÍNH (2026-06-26):** publish IG phải gọi **graph.facebook.com**, KHÔNG phải graph.instagram.com.
> Dùng graph.instagram.com với page token → `code 190 "Cannot parse access token"`.

### Chuẩn bị
1. IG account phải là **Business hoặc Creator** (không phải Personal). Đổi trong IG app → Settings →
   Account type.
2. **Link IG vào FB Page:** FB Page → Settings → Linked accounts → Instagram → Connect.
3. Token FB Page (mục 1) phải có scopes `instagram_basic` + `instagram_content_publish`.

### Lấy IG User ID
```bash
curl -sG "https://graph.facebook.com/v25.0/<PAGE_ID>" \
  --data-urlencode "fields=instagram_business_account" \
  --data-urlencode "access_token=<PAGE_TOKEN>"
# trả về {"instagram_business_account":{"id":"<IG_USER_ID>"}}
```
Nếu trả về chỉ `{name,id}` (không có instagram_business_account) → IG CHƯA link vào Page, làm lại bước link.

### Verify
```bash
curl -sG "https://graph.facebook.com/v25.0/<IG_USER_ID>" \
  --data-urlencode "fields=id,username" --data-urlencode "access_token=<PAGE_TOKEN>"
# OK = {"id":"...","username":"<ig handle>"}
```

### Env
```
MKT_IG_USER_ID=<IG user id từ instagram_business_account>
MKT_IG_ACCESS_TOKEN=<= GIỐNG HỆT MKT_FB_PAGE_ACCESS_TOKEN>
```

---

## 3. THREADS — long-lived 60 ngày (app RIÊNG, không phải app FB)

### Chuẩn bị
1. Threads account (đăng nhập được).
2. App tại developers.facebook.com → thêm use-case **Threads API** (app riêng, KHÔNG dùng app FB ở mục 1).

### Các bước
1. App Dashboard → **Threads** use case → **Settings**.
2. Thêm Threads account làm **Tester** → account đó phải **ACCEPT invite**:
   threads.net → Settings → Account → Website permissions → **Invites** → Accept.
   (KHÔNG cần business verification / app review cho self-publish ở dev mode.)
3. Scopes: `threads_basic` + `threads_content_publish`.
4. Generate token → đây là short-lived (~1h). **Đổi sang long-lived (60 ngày):**
   ```bash
   curl -sG "https://graph.threads.net/access_token" \
     --data-urlencode "grant_type=th_exchange_token" \
     --data-urlencode "client_secret=<THREADS_APP_SECRET>" \
     --data-urlencode "access_token=<SHORT_LIVED_TOKEN>"
   # trả về {"access_token":"<LONG_LIVED>","expires_in":5183944}  (~60 ngày)
   ```
5. **Lấy Threads User ID:**
   ```bash
   curl -sG "https://graph.threads.net/v1.0/me" \
     --data-urlencode "fields=id,username" --data-urlencode "access_token=<LONG_LIVED>"
   ```

### Refresh (gia hạn trước khi hết 60 ngày)
```bash
curl -sG "https://graph.threads.net/refresh_access_token" \
  --data-urlencode "grant_type=th_refresh_token" --data-urlencode "access_token=<LONG_LIVED>"
# trả về token mới ~60 ngày. (Workflow mkt-meta-token-refresh tự làm việc này.)
```

### Env
```
MKT_THREADS_USER_ID=<threads user id>
MKT_THREADS_ACCESS_TOKEN=<long-lived 60 ngày>
```

---

## 4. LINKEDIN — feed cá nhân, FREE (Token Generator, không cần code OAuth)

> ⚠️ Dùng đường consumer **"Share on LinkedIn"** (`/v2/ugcPosts` + `/v2/assets`) — chỉ cần scope
> `w_member_social`, KHÔNG cần pháp nhân. ĐỪNG dùng `/rest/posts` (Community Management API = cần Partner
> verification + pháp nhân).

### Các bước
1. **linkedin.com/developers/apps** → **Create app**:
   - App name, **LinkedIn Page** (gắn 1 page bất kỳ — tạo tạm cũng được), logo → Create.
2. Tab **Products** → **Request access**:
   - **Share on LinkedIn** (cấp `w_member_social`).
   - **Sign In with LinkedIn using OpenID Connect** (để lấy person ID).
   (Cả hai thường auto-approve ngay.)
3. Tab **Auth** → **OAuth 2.0 tools** → **Create token** (Token Generator):
   - Tick scopes: `w_member_social` + `openid` + `profile`.
   - **Generate** → đăng nhập account muốn đăng → Authorize → **copy access token** (sống 60 ngày).
4. **Lấy Person ID** (field `sub`):
   ```bash
   curl -sG "https://api.linkedin.com/v2/userinfo" \
     -H "Authorization: Bearer <ACCESS_TOKEN>"
   # trả về {"sub":"<PERSON_ID>","name":"...","email":"..."}
   # PERSON_ID là chuỗi sau "sub", KHÔNG phải vanity slug
   ```

### Verify (registerUpload — chứng minh scope w_member_social, không tạo post)
```bash
curl -s -X POST "https://api.linkedin.com/v2/assets?action=registerUpload" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "X-Restli-Protocol-Version: 2.0.0" -H "Content-Type: application/json" \
  -d '{"registerUploadRequest":{"recipes":["urn:li:digitalmediaRecipe:feedshare-image"],"owner":"urn:li:person:<PERSON_ID>","serviceRelationships":[{"relationshipType":"OWNER","identifier":"urn:li:userGeneratedContent"}]}}'
# OK = {"value":{"asset":"urn:li:digitalmediaAsset:...","uploadMechanism":{...}}}
```

### Env
```
MKT_LINKEDIN_PERSON_ID=<sub từ /v2/userinfo>
MKT_LINKEDIN_ACCESS_TOKEN=<token 60 ngày>
```

---

## 5. X (TWITTER) — Generic OAuth2 + PKCE trong n8n vault (TÍNH PHÍ 💰)

> ⚠️ **2 BẪY ĐÃ DÍNH (2026-06-26):**
> 1. **PHẢI nạp credit trước** (pay-per-use, không còn free write tier). Chưa nạp = mọi call bị chặn.
> 2. Đăng ảnh cần scope **`media.write`**. Credential **predefined "X OAuth2 API"** của n8n THIẾU scope này
>    → upload ảnh 403. PHẢI dùng credential **generic "OAuth2 API"** (tự khai scope đủ).

### Chuẩn bị (phía X)
1. **developer.x.com** → tạo **Project → App**.
2. App → **User authentication settings** → Edit:
   - **App permissions:** Read and write
   - **Type of App:** Web App, Automated App or Bot (confidential → có Client Secret)
   - **Callback URI:** (điền sau, lấy từ n8n ở bước dưới)
   - Save.
3. Tab **Keys and tokens** → mục **OAuth 2.0 Client ID and Client Secret** → copy cả 2.
4. **Nạp credit:** Developer Console → Billing → nạp (vài $ đủ test; $0.015/post thường, $0.20/post-có-link).

### Tạo credential trong n8n (vault, auto-refresh)
1. n8n → **Credentials → Add credential** → search **"OAuth2 API"** (generic — KHÔNG phải 2 cái
   "X OAuth2 API"/"X OAuth API" predefined; chúng có scope cố định, thiếu media.write).
2. **COPY "OAuth Redirect URL"** n8n hiện ở đầu form (kiểu
   `http://localhost:5678/rest/oauth2-credential/callback`) → dán vào X app → User authentication settings →
   **Callback URI** → Save.
3. Điền form credential:
   | Field | Giá trị |
   |-------|---------|
   | Grant Type | `PKCE` |
   | Authorization URL | `https://twitter.com/i/oauth2/authorize` (hằng số, không lấy từ dashboard) |
   | Access Token URL | `https://api.twitter.com/2/oauth2/token` (hằng số) |
   | Client ID | (từ bước 3 phía X) |
   | Client Secret | (từ bước 3 phía X) |
   | **Scope** | `tweet.read tweet.write users.read media.write offline.access` ⚠️ **cách nhau DẤU CÁCH, không phẩy** |
   | Auth URI Query Parameters | (để trống) |
   | Authentication | `Header` |
4. **Connect my account** → popup X → đăng nhập account đăng bài → **Authorize app**.
   → n8n lưu token + refresh token vào vault, **tự refresh mỗi ~2h** (nhờ `offline.access`).
5. Đặt tên credential (vd `X DAIS media`) → Save.

### Bind credential vào workflow
2 node HTTP của X (`x-upload-media` + `x-create-tweet`) dùng:
```
authentication: genericCredentialType
genericAuthType: oAuth2Api
credentials.oAuth2Api: { id: "<credential id>" }
```
Lấy credential id qua n8n API hoặc MCP `n8n_manage_credentials action=list` → bind → push workflow.

### Env
X **KHÔNG dùng $env** (token vault). Chỉ cần credential id trong workflow JSON.

### Bẫy còn lại
- Một số dev báo `/2/media/upload` qua OAuth2 vẫn 403 kể cả có `media.write` (vấn đề phía X, tới 5/2026).
  Nếu gặp: fallback tweet text-only (chỉ cần `tweet.write`), hoặc chờ X fix.
- Post có URL thật trong text = **$0.20/bài** + X bóp reach. Dùng "link in bio", không nhét URL.

---

## Checklist verify nhanh (chạy trước mỗi đợt test — không in token)

```bash
set -a && . ./n8n-local/.env 2>/dev/null && set +a

# FB — phải trả về tên PAGE + id khớp
curl -sG "https://graph.facebook.com/v25.0/me" --data-urlencode "fields=id,name" \
  --data-urlencode "access_token=${MKT_FB_PAGE_ACCESS_TOKEN}"

# IG — phải trả về username
curl -sG "https://graph.facebook.com/v25.0/${MKT_IG_USER_ID}" --data-urlencode "fields=id,username" \
  --data-urlencode "access_token=${MKT_IG_ACCESS_TOKEN}"

# Threads — phải trả về username
curl -sG "https://graph.threads.net/v1.0/me" --data-urlencode "fields=id,username" \
  --data-urlencode "access_token=${MKT_THREADS_ACCESS_TOKEN}"

# LinkedIn — phải trả về sub
curl -sG "https://api.linkedin.com/v2/userinfo" -H "Authorization: Bearer ${MKT_LINKEDIN_ACCESS_TOKEN}"

# X — verify trong n8n UI (credential → Reconnect nếu cần). Không có $env để curl.
```

| Lỗi | Nghĩa | Sửa |
|-----|-------|-----|
| FB/IG `190 subcode 463` | Token hết hạn | FB/IG: lấy lại page token từ System User |
| FB/IG `190 "Cannot parse access token"` | IG gọi sai host | Dùng graph.facebook.com (không instagram.com) |
| `190 "Application has been deleted"` | App bị xóa | Tạo app mới + làm lại |
| `200 "API access blocked"` | Meta tạm khóa (spam) | Chờ 24-48h, giảm tần suất đăng |
| Threads `452` | Token short-lived | Đổi long-lived (th_exchange_token) |
| LinkedIn `403` registerUpload | Thiếu w_member_social | Thêm product "Share on LinkedIn" |
| X upload `403` | Thiếu media.write | Dùng generic OAuth2, không predefined |

---

## Deploy env vào container (sau khi có token FB/IG/Threads/LinkedIn)

```bash
# Container đọc n8n-local/.env, KHÔNG phải AgentPortal/.env. Chỉ upsert key đổi, giữ key khác.
# Sau khi sửa .env: PHẢI force-recreate (restart KHÔNG nạp lại env_file).
cd /c/Users/Vincere/Desktop/n8n/n8n-local && docker compose up -d --force-recreate n8n

# Verify env trong container (độ dài, không in token)
docker exec n8n-local-n8n-1 sh -c 'for k in MKT_FB_PAGE_ACCESS_TOKEN MKT_IG_ACCESS_TOKEN MKT_THREADS_ACCESS_TOKEN MKT_LINKEDIN_ACCESS_TOKEN MKT_LINKEDIN_PERSON_ID; do v=$(printenv $k); echo "$k=(${#v} chars)"; done'
```
X không cần bước này (vault). ⚠️ Đừng force-recreate khi đang có execution chạy dở (Threads Wait 35s) → crash.

---

## Trạng thái verified (2026-06-26) — cả 5 nền đăng bài thật thành công

| Nền | Token model | Verified |
|-----|-------------|:---:|
| Facebook | Page token vĩnh viễn (System User) | ✅ |
| Instagram | = FB page token, graph.facebook.com | ✅ |
| Threads | Long-lived 60d | ✅ |
| LinkedIn | OAuth2 60d, /v2/ugcPosts | ✅ |
| X | Generic OAuth2 vault, media.write | ✅ |
