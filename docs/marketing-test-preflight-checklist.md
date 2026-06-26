# Marketing Pipeline — Test Preflight Checklist

Mục đích: chạy preflight TRƯỚC mỗi lần test publish, tránh phát hiện token chết / sai endpoint / sai env
giữa chừng. Chạy tuần tự, **dừng ngay khi 1 mục FAIL** và sửa theo bảng dưới mục đó.

> **Quy tắc vàng:** Verify từ ngoài vào trong — **token → identity → publish-path → env nạp → workflow → data row.**
> Đừng activate gì cho tới khi tất cả xanh. Token model từng platform xem `marketing-social-token-deployment.md`.

---

## 0. Bảo mật khi verify (BẮT BUỘC)

- **KHÔNG in giá trị token.** Check tên + độ dài:
  ```bash
  awk -F= '/^MKT_/ {v=$2; gsub(/[ \r]/,"",v); print $1 "=" (v=="" ? "(EMPTY)" : "(set, "length(v)" chars)")}' .env
  ```
- Load env vào shell rồi dùng `${VAR}`, đừng paste token literal:
  ```bash
  set -a && . ./.env 2>/dev/null && set +a
  ```
- Parse JSON bằng node/python, chỉ in field cần (`name`/`id`/`username`/`error`), không in token.

---

## 1. Token còn sống? (lớp hay chết nhất)

```bash
set -a && . ./.env 2>/dev/null && set +a

# FB Page token → phải trả về CHÍNH PAGE (name = tên page), id khớp MKT_FB_PAGE_ID
curl -sG "https://graph.facebook.com/v25.0/me" \
  --data-urlencode "fields=id,name" --data-urlencode "access_token=${MKT_FB_PAGE_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.error?"FB FAIL: "+j.error.message:("FB OK page=\""+j.name+"\" match="+(j.id===process.env.MKT_FB_PAGE_ID)));})' MKT_FB_PAGE_ID="$MKT_FB_PAGE_ID"

# IG → dùng chung page token, query qua IG user id
curl -sG "https://graph.facebook.com/v25.0/${MKT_IG_USER_ID}" \
  --data-urlencode "fields=id,username" --data-urlencode "access_token=${MKT_IG_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.error?"IG FAIL: "+j.error.message:("IG OK @"+j.username));})'

# Threads
curl -sG "https://graph.threads.net/v1.0/me" \
  --data-urlencode "fields=id,username" --data-urlencode "access_token=${MKT_THREADS_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.error?"Threads FAIL: "+j.error.message:("Threads OK @"+j.username));})'
```

| Lỗi | Nghĩa | Sửa |
|-----|-------|-----|
| `190 subcode 463 "Session has expired"` | Token short-lived hết hạn | FB/IG: lấy lại page token từ System User (đừng dùng token có hạn). Threads: lấy long-lived. |
| `190 "Cannot parse access token"` | Token rác / sai định dạng | Dán lại đúng token |
| `190 "Application has been deleted"` | App cấp token bị xóa | Tạo app mới + làm lại System User flow |
| FB `match=false` | Token không phải page token (là system-user/user token) | Mint page token qua `/me/accounts` (xem deployment guide §1) |
| IG `Object ... does not exist` | `MKT_IG_USER_ID` sai/cũ | Lấy lại từ `instagram_business_account` của page |

---

## 2. Publish-path còn chạy? (dry-run — KHÔNG đăng thật)

Tạo container/draft để chứng minh đường publish thông, KHÔNG publish ra public.

```bash
set -a && . ./.env 2>/dev/null && set +a

# FB: unpublished photo (an toàn, không lên feed)
curl -s -X POST "https://graph.facebook.com/v25.0/${MKT_FB_PAGE_ID}/photos" \
  --data-urlencode "url=https://www.gstatic.com/webp/gallery/1.jpg" \
  --data-urlencode "published=false" \
  --data-urlencode "access_token=${MKT_FB_PAGE_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.error?"FB publish FAIL: "+JSON.stringify(j.error):("FB publish OK id="+(j.id||j.post_id)));})'

# IG: tạo media container (KHÔNG gọi media_publish) — container tự hết hạn 24h
curl -s -X POST "https://graph.facebook.com/v25.0/${MKT_IG_USER_ID}/media" \
  --data-urlencode "image_url=https://www.gstatic.com/webp/gallery/1.jpg" \
  --data-urlencode "caption=preflight" \
  --data-urlencode "access_token=${MKT_IG_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.error?"IG container FAIL: "+JSON.stringify(j.error):("IG container OK id="+j.id));})'

# Threads: tạo container (KHÔNG gọi threads_publish)
curl -s -X POST "https://graph.threads.net/v1.0/${MKT_THREADS_USER_ID}/threads" \
  --data-urlencode "media_type=IMAGE" \
  --data-urlencode "image_url=https://www.gstatic.com/webp/gallery/1.jpg" \
  --data-urlencode "text=preflight" \
  --data-urlencode "access_token=${MKT_THREADS_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.error?"Threads container FAIL: "+JSON.stringify(j.error):("Threads container OK id="+j.id));})'
```

| Lỗi | Nghĩa | Sửa |
|-----|-------|-----|
| FB `(#200) must be posted to a page as the page itself` | Đang dùng system-user token, không phải page token | Mint page token (deployment guide §1) |
| IG/Threads `(#10)` hoặc scope error | Token thiếu scope publish | Generate lại token với `instagram_content_publish` / `threads_content_publish` |
| `image_url ... not accessible` | Drive ảnh không public | Folder Drive phải "anyone with link"; URL `lh3.googleusercontent.com/d/{fileId}` |

---

## 3. Long-lived OK? (chỉ Threads — bền 60 ngày)

```bash
curl -sG "https://graph.threads.net/refresh_access_token" \
  --data-urlencode "grant_type=th_refresh_token" --data-urlencode "access_token=${MKT_THREADS_ACCESS_TOKEN}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.error)console.log("NOT long-lived: "+j.error.message);else console.log("LONG-LIVED ✓ ~"+Math.floor(j.expires_in/86400)+"d");})'
```
- `~59-60d` = OK. `code 452 "Session key invalid"` = token short-lived → lấy long-lived trước khi test.
- FB/IG page token (từ System User never-expire) = vĩnh viễn, không cần check này.

---

## 4. Env đã NẠP vào container chưa? (bẫy 2 file .env — hay dính nhất)

**Container đọc `n8n-local/.env`, KHÔNG phải `AgentPortal/.env`.** Sửa file ≠ container thấy ngay.

```bash
# So token đã sync đúng vào file container đọc
awk -F= '/^MKT_(FB_PAGE_ACCESS_TOKEN|IG_|THREADS_)/ {v=$2;gsub(/[ \r]/,"",v);print "  "$1"=("length(v)" chars)"}' \
  /c/Users/Vincere/Desktop/n8n/n8n-local/.env

# Nạp env: PHẢI force-recreate (docker restart KHÔNG nạp lại env_file)
cd /c/Users/Vincere/Desktop/n8n/n8n-local && docker compose up -d --force-recreate n8n

# Verify env trong container (độ dài, không in token)
docker exec n8n-local-n8n-1 sh -c 'for k in MKT_FB_PAGE_ACCESS_TOKEN MKT_IG_USER_ID MKT_IG_ACCESS_TOKEN MKT_THREADS_USER_ID MKT_THREADS_ACCESS_TOKEN; do v=$(printenv $k); echo "$k=(${#v} chars)"; done'
```

> ⚠️ Đừng force-recreate khi đang có execution chạy dở (Wait 30-35s) → crash, row kẹt `posting`.

---

## 5. Workflow trên instance khớp file chưa?

```
n8n_get_workflow(id, mode='structure')  → so node count + tên node
n8n_validate_workflow(id)               → valid:true, errorCount:0 (warnings về typeVersion/$json = bỏ qua)
```

| ID | Workflow | Node count |
|----|----------|-----------|
| `5CRqybESYUoc03Gl` | mkt-post-scheduler | 35 |
| `SUOTju5if0Ch0ASc` | mkt-meta-token-refresh | 11 |
| `sdpQoLqGeW3Y8dAy` | mkt-copy-gen | 8 |

Push file local → instance bằng **MCP** (`n8n_update_full_workflow`), KHÔNG dùng `n8n import:workflow`
(repo không mount vào container). Endpoint FB/IG = **v25.0**, Threads = `graph.threads.net/v1.0`.

---

## 6. Data row trên Sheet đúng chưa?

Copy do **Gemini sinh tự động** — KHÔNG gõ tay `copyVi`/`copyEn`/`copyThreads`.
```
status=brief (product+angle, copy TRỐNG) → copy-gen/Gemini → status=review (copy đã sinh)
  → người duyệt: set status=ready + scheduledAt(quá khứ) → scheduler đăng
```

| Cột | Giá trị test |
|-----|-------------|
| `product`, `angle` | điền |
| `copyVi`, `copyEn`, `copyThreads` | **để trống** (Gemini điền) |
| `driveFolderId` | folder Drive share "anyone with link" |
| `heroFile` | tên file ảnh chính xác trong folder (vd `agentflow.png`) |
| `platforms` | `facebook,threads,instagram` |
| `scheduledAt` | sau review set = quá khứ để "due" ngay |
| `status` | `brief` → (Gemini) `review` → (người) `ready` |

Sheet CẦN header `copyThreads` (Threads dùng bản ≤480 riêng, không cắt cứng copyVi).

---

## 7. Trigger + đọc kết quả (cron không force-run tay được)

- copy-gen cron `*/10`, scheduler `*/20` — n8n public API KHÔNG force-run cron. Activate rồi chờ tick.
- Đọc: `n8n_executions list workflowId=<id>` → exec mới → `get mode=error` (nếu fail) hoặc `mode=filtered`.

---

## Thứ tự chạy gọn (mỗi lần test)

```
[ ] §0  load env an toàn, không in secret
[ ] §1  3 token /me OK + FB match=true + IG/Threads đúng username
[ ] §2  dry-run publish 3 platform ra id (không đăng thật)
[ ] §3  Threads long-lived ✓ (~60d)
[ ] §4  sync n8n-local/.env → compose up --force-recreate → verify env trong container
[ ] §5  validate 3 workflow (35/11/8 nodes, errorCount 0)
[ ] §6  Sheet row: status=brief, copy trống, driveFolderId+heroFile đúng, platforms cả 3
[ ] §7  copy-gen active → tick → review → approve → scheduler active → đọc execution
```

---

## Trạng thái đã biết (cập nhật 2026-06-25 cuối session)

### ✅ Đã verify — cả 3 platform READY (dry-run thật)
- **FB** page "Data Agentic Solutions Company" (`1119172831269274`): page token never-expire từ System User
  "Admin_MKT". Dry-run unpublished post OK.
- **IG** `@nghiep.t.lam` (`17841405738807290`): đã link vào FB Page → dùng chung page token. Dry-run container OK.
- **Threads** `@nghiep.t.lam` (`26752592914417964`): long-lived ~60d (refresh verified). Dry-run container OK.
- Cả 6 env var đúng, đã sync vào `n8n-local/.env` + force-recreate. Container có token đúng.

### ⚠️ Chưa làm (không chặn test)
- **Chưa đăng bài PUBLIC thật** — mọi verify là dry-run. Cần user OK rõ vì post public không thu hồi được.
- **3 credential id rỗng** (`MKT_FB_CREDENTIAL_ID`, `MKT_THREADS_CREDENTIAL_ID`): workflow token-refresh
  nhánh Threads PATCH credential theo id này. Trống → Threads auto-refresh chưa ghi lại được token mới.
  Cần điền id credential n8n nếu muốn refresh tự động ghi vào vault.
- **X + LinkedIn**: build hôm sau, dùng **free tier** (nếu free không cho post → gói premium). Research
  token model trước khi build.

### Workflow trên instance (cuối session)
- mkt-post-scheduler (`5CRqybESYUoc03Gl`): inactive, cron `*/20`, 35 nodes, v25.0.
- mkt-meta-token-refresh (`SUOTju5if0Ch0ASc`): inactive, 11 nodes, **secret-free** (FB/IG `/me` liveness,
  Threads `th_refresh_token`).
- mkt-copy-gen (`sdpQoLqGeW3Y8dAy`): inactive, 8 nodes.

Liên kết: deployment guide `marketing-social-token-deployment.md` · [[project_marketing_leadgen_pipeline]]
