# Marketing Pipeline — Social Token Deployment Guide

Mục đích: tài liệu chuẩn cho việc **lấy / verify / deploy access token** của các platform mạng xã hội
trong pipeline marketing (`mkt-post-scheduler`, `mkt-meta-token-refresh`). Viết sau khi tốn nguyên buổi
2026-06-25 dò token vì không nắm rõ token model. **Đọc trước mỗi lần deploy / khi token chết.**

> Quy tắc vàng: **token model của mỗi platform KHÁC NHAU.** Đừng giả định. Sai loại token = lỗi "long live",
> "cannot parse", "client secret invalid", "application deleted" — tất cả đều gặp trong 1 buổi.

---

## 0. Bản đồ token (mỗi platform 1 mô hình)

| Platform | Token cuối cùng dùng để đăng | Vòng đời | Tự refresh? | Cần app secret? |
|----------|------------------------------|----------|-------------|-----------------|
| **Facebook** | **Page token** (từ System User) | Vĩnh viễn (nếu System User never-expire) | Không cần | Không (xem cách dưới) |
| **Instagram** | Page token (chung với FB, có scope IG) | Vĩnh viễn | Không cần | Không |
| **Threads** | Long-lived user token | 60 ngày | **Có** (`th_refresh_token`, KHÔNG cần secret) | Chỉ ở bước exchange short→long |

Env vars (file `n8n-local/.env` — xem §4):
```
MKT_FB_PAGE_ID            = id của FB Page
MKT_FB_PAGE_ACCESS_TOKEN  = PAGE token (không phải system-user token, không phải user token)
MKT_IG_USER_ID            = IG Business account id (lấy từ instagram_business_account của page)
MKT_IG_ACCESS_TOKEN       = chung giá trị với MKT_FB_PAGE_ACCESS_TOKEN (page token có scope IG)
MKT_THREADS_USER_ID       = Threads user id (từ graph.threads.net/v1.0/me)
MKT_THREADS_ACCESS_TOKEN  = Threads long-lived token
```

---

## 1. Facebook — cách lấy PAGE token vĩnh viễn (KHÔNG cần app secret)

**Nguồn gốc mọi lỗi "long live":** Page token lấy thẳng từ Graph API Explorer là **short-lived (~1-2h)**.
Derive từ user-token short-lived cũng ra page-token có hạn. Cần một con đường **vĩnh viễn**.

### Cách đúng: System User token (Business) → Page token

System User token là token automation **không hết hạn**, và mint page token từ nó **không cần app secret**.

**Bước 1 — Tạo System User + gán Page (làm trên browser, 1 lần):**
1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Users → System Users** → Add
   → role **Admin**.
2. **QUAN TRỌNG — Page phải nằm trong Business Portfolio TRƯỚC:** Business Settings → **Accounts → Pages**.
   Nếu page chưa có → **Add → Add a Page** (tài khoản cá nhân của bạn phải là admin của page).
   *Page không hiện ở bước gán = vì bước này chưa làm.* (Đã dính 2026-06-25.)
3. Quay lại System User → **Add Assets** → tab **Pages** → tick page → bật quyền **Manage Page / Content** → Save.
4. **Generate new token** → chọn đúng **App** (app phải còn sống — xem cảnh báo dưới) →
   scopes: `pages_show_list, pages_read_engagement, pages_manage_posts`
   (+ `instagram_basic, instagram_content_publish` nếu dùng IG) →
   **Token expiration: Never** → Generate.

**Bước 2 — Đổi System User token → Page token (qua API, không secret):**
```bash
set -a && . ./.env 2>/dev/null && set +a
# /me/accounts trả page token cho từng page system user quản lý
curl -sG "https://graph.facebook.com/v25.0/me/accounts" \
  --data-urlencode "fields=id,name,access_token,instagram_business_account{id,username}" \
  --data-urlencode "access_token=${SYSTEM_USER_TOKEN}"
```
→ Tìm page có `id == MKT_FB_PAGE_ID`, lấy `access_token` của nó. **ĐÂY là page token** → ghi vào
`MKT_FB_PAGE_ACCESS_TOKEN`. Page token này sống cùng vòng đời System User token (never-expire).

> Phân biệt: `GET /me` trên **system-user token** trả về system user (vd "Admin_MKT").
> `GET /me` trên **page token** trả về chính Page ("Data Agentic Solutions Company"). Workflow đăng bài
> phải dùng PAGE token — system-user token bị `(#200) Unpublished posts must be posted to a page as the page itself`.

### ⚠️ Cảnh báo App
- **Xóa app = token chết vĩnh viễn.** Lỗi `code 190 "Application has been deleted"`. Đừng xóa app đang
  cấp token. (Đã dính 2026-06-25 — phải tạo app mới + làm lại từ đầu.)
- App secret FB **không lấy được / không cần** cho luồng này → đã thiết kế workflow KHÔNG dùng secret.

---

## 2. Instagram — dùng chung Page token (không token riêng)

Setup hiện tại: IG Business account `@nghiep.t.lam` **link vào FB Page** "Data Agentic Solutions Company".
→ IG publish dùng **chính page token** (đã có scope `instagram_content_publish`), KHÔNG cần token riêng.

**Prereq (Meta-side, làm trên app Instagram hoặc Page settings):**
- IG account phải là **Business/Creator** (không phải personal).
- IG phải **link vào FB Page**: Page → Settings → Linked accounts → Instagram.

**Lấy `MKT_IG_USER_ID` (sau khi link):**
```bash
curl -sG "https://graph.facebook.com/v25.0/${MKT_FB_PAGE_ID}" \
  --data-urlencode "fields=instagram_business_account{id,username}" \
  --data-urlencode "access_token=${MKT_FB_PAGE_ACCESS_TOKEN}"
```
→ `instagram_business_account.id` = `MKT_IG_USER_ID`. `MKT_IG_ACCESS_TOKEN` = chung page token.

> Lỗi `Object with ID '...' does not exist` ở IG = `MKT_IG_USER_ID` SAI (id rác / id cũ / chưa link).
> Luôn lấy lại id từ `instagram_business_account`, đừng hardcode id cũ.
>
> Endpoint publish IG = `graph.facebook.com/v25.0/{IG_USER_ID}/media` + `/media_publish` (Facebook-Login
> flow, vì IG link qua Page). KHÔNG phải `graph.instagram.com` (đó là Instagram-Login flow, token `IGAA`,
> setup khác — pipeline này KHÔNG dùng).

---

## 3. Threads — long-lived 60 ngày, tự refresh

Threads là app/luồng **riêng**, KHÔNG dùng page token FB.

**Lấy long-lived token:**
- Cách đơn giản (không secret): App Dashboard → **Threads use case → Generate access token** cho account.
  Token này thường đã long-lived sẵn.
- Cách exchange (CẦN Threads App Secret — secret riêng, ≠ FB secret):
  ```bash
  curl -sG "https://graph.threads.net/access_token" \
    --data-urlencode "grant_type=th_exchange_token" \
    --data-urlencode "client_secret=${MKT_THREADS_APP_SECRET}" \
    --data-urlencode "access_token=${SHORT_LIVED_THREADS_TOKEN}"
  ```

**Verify long-lived (test quyết định):**
```bash
curl -sG "https://graph.threads.net/refresh_access_token" \
  --data-urlencode "grant_type=th_refresh_token" \
  --data-urlencode "access_token=${MKT_THREADS_ACCESS_TOKEN}"
```
- Trả `expires_in ≈ 5,184,000s (~60d)` = **LONG-LIVED ✓**.
- Trả `code 452 "Session key invalid"` = token đang **short-lived** → phải lấy long-lived (đừng dùng).

**Lấy `MKT_THREADS_USER_ID`:**
```bash
curl -sG "https://graph.threads.net/v1.0/me" \
  --data-urlencode "fields=id,username" --data-urlencode "access_token=${MKT_THREADS_ACCESS_TOKEN}"
```

**Refresh tự động:** workflow `mkt-meta-token-refresh` nhánh Threads gọi `th_refresh_token` hằng tuần
(không cần secret). Chỉ chạy được khi token **đang sống & đã long-lived** — nên lần đầu phải đặt long-lived
bằng tay, sau đó workflow tự gia hạn mãi.

> Lưu ý: mỗi lần `th_refresh_token` Meta trả về **token MỚI** (reset 60 ngày). Workflow PATCH token mới vào
> n8n credential. Nếu chạy refresh bằng tay để test, token mới đó bị bỏ — không sao, token cũ vẫn còn 60 ngày.

---

## 4. Deploy env vào n8n (bẫy 2 file .env — đã dính 4+ lần)

**Container n8n đọc `C:\Users\Vincere\Desktop\n8n\n8n-local\.env`, KHÔNG phải `AgentPortal/.env`.**
n8n chạy từ stack riêng `n8n-local` (container `n8n-local-n8n-1`), không phải docker-compose của AgentPortal.

Quy trình deploy token (sau khi verify token đúng):
```bash
# 1. Ghi token vào n8n-local/.env (file container thật sự đọc)
#    — chỉ upsert key thay đổi, GIỮ NGUYÊN key khác.

# 2. Nạp env: PHẢI force-recreate, KHÔNG phải restart.
cd /c/Users/Vincere/Desktop/n8n/n8n-local
docker compose up -d --force-recreate n8n
```

> ⚠️ **`docker restart` KHÔNG nạp lại `env_file`** — env chỉ inject lúc container *create*. Đã dính
> 2026-06-25: restart xong container vẫn giữ token cũ. Phải `compose up --force-recreate`.

Verify env đã vào container (chỉ in độ dài, không in token):
```bash
docker exec n8n-local-n8n-1 sh -c 'for k in MKT_FB_PAGE_ACCESS_TOKEN MKT_IG_USER_ID MKT_IG_ACCESS_TOKEN MKT_THREADS_USER_ID MKT_THREADS_ACCESS_TOKEN; do v=$(printenv $k); echo "$k=(${#v} chars)"; done'
```

> ⚠️ **Đừng force-recreate khi đang có execution chạy dở** (Threads/IG có Wait 30-35s) →
> `WorkflowCrashedError`, row kẹt ở `posting`. Đợi execution xong rồi mới recreate.

---

## 5. Workflow trên instance (push qua MCP, KHÔNG qua CLI)

Sửa file JSON local ≠ instance tự cập nhật. Repo `./files` KHÔNG mount vào container n8n-local →
`n8n import:workflow` vô dụng. Đẩy bằng **MCP**: `n8n_update_full_workflow` / `n8n_update_partial_workflow`.

| ID | Workflow | Node count |
|----|----------|-----------|
| `5CRqybESYUoc03Gl` | mkt-post-scheduler | 35 |
| `SUOTju5if0Ch0ASc` | mkt-meta-token-refresh | 11 (secret-free liveness) |
| `sdpQoLqGeW3Y8dAy` | mkt-copy-gen | 8 |

Workflow tồn tại trong **DB của n8n**, không trong container → sống sót qua `force-recreate`.

**Graph API version:** tất cả endpoint FB/IG dùng **v25.0** (Threads dùng `graph.threads.net/v1.0` riêng).

---

## 6. Bảo mật token (BẮT BUỘC)

- **KHÔNG in giá trị token ra output.** Verify bằng tên + độ dài + identity (`/me` trả name/username/id):
  ```bash
  awk -F= '/^MKT_/ {v=$2; gsub(/[ \r]/,"",v); print $1 "=" (v=="" ? "(EMPTY)" : "(set, "length(v)" chars)")}' .env
  ```
- File `.env` + `.env.bak.*` chứa token thật → **gitignored, KHÔNG commit.** Xóa backup sau khi xong.
- App secret (nếu có) chỉ chạy **server-side**, không bao giờ vào client/log/chat. [[feedback_never_push_env]]
- Lỡ lộ token qua screenshot/chat → **reset** token/secret ngay khi xong việc.

---

## Lịch sử lỗi 2026-06-25 (để không lặp lại)

| Lỗi gặp | Nguyên nhân thật | Bài học |
|---------|------------------|---------|
| `code 190 subcode 463 "Session has expired"` | Page token short-lived hết hạn | Dùng System User → page token never-expire |
| `code 190 "Cannot parse access token"` | Token rác / sai định dạng | Verify identity bằng `/me` trước |
| `"Error validating client secret"` | FB App Secret sai (27 ký tự, phải 32 hex) + dùng sai loại token (PAGE thay vì USER cho `fb_exchange_token`) | Bỏ luôn luồng cần secret — dùng System User |
| `code 190 "Application has been deleted"` | App cấp token bị xóa | Đừng xóa app đang dùng |
| `/me/accounts` rỗng (0 pages) | Page chưa assign cho System User | Add page vào Business Portfolio TRƯỚC, rồi mới assign |
| IG `Object ... does not exist` | `MKT_IG_USER_ID` là id rác/cũ | Lấy id từ `instagram_business_account` |
| Threads `code 452` khi refresh | Token short-lived, không refresh được | Phải đặt long-lived 1 lần trước |
| Container giữ token cũ sau update | `docker restart` không nạp env_file | `compose up --force-recreate` |

Liên kết: [[project_marketing_leadgen_pipeline]] · checklist test: `marketing-test-preflight-checklist.md`
