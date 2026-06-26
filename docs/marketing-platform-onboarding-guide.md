# Marketing Pipeline — Hướng Dẫn Onboarding Cho Khách (Platform Setup + Chi Phí)

> Tài liệu này dùng để **deal với khách + hướng dẫn khách chuẩn bị** mọi thứ phía nền tảng trước khi
> triển khai pipeline đăng bài tự động. Mô hình bán = **deploy pipeline trên hệ thống của CHÍNH khách**
> (n8n của khách, app/token Meta-X-LinkedIn của khách). Single-tenant per-install.

Cập nhật: 2026-06-26. Endpoint Meta = Graph v25.0, Threads v1.0, LinkedIn versioned 202606 / consumer v2.

---

## TL;DR — Bảng chi phí (cái nào FREE, cái nào TÍNH PHÍ)

| Nền tảng | Đăng text/ảnh | Đăng video | **Chi phí API** | Token sống bao lâu | Độ khó setup |
|----------|:---:|:---:|---|---|---|
| **Facebook Page** | ✅ | ✅ | **FREE** | Never-expire (System User) | Trung bình |
| **Instagram** | ✅ | ✅ Reels | **FREE** | Dùng chung token FB Page | Trung bình |
| **Threads** | ✅ | ✅ | **FREE** | 60 ngày (refresh được) | Dễ–Trung bình |
| **LinkedIn** (feed cá nhân) | ✅ | ✅ | **FREE** | 60 ngày + refresh 365 ngày | Dễ |
| **X (Twitter)** | ✅ | ✅ | **TÍNH PHÍ** 💰 | Tùy OAuth | Khó |

**Chốt nhanh khi tư vấn khách:**
- **4/5 nền MIỄN PHÍ** API (FB, IG, Threads, LinkedIn). Chỉ tốn công setup + ảnh/video do khách cung cấp.
- **X tính phí thật:** $0.015/bài thường, **$0.20/bài có link**, nạp credit trước. Reach post-có-link bị X bóp.
  → Nếu khách không bắt buộc có mặt trên X, **khuyên bỏ X** hoặc **tính phí vận hành X riêng** vào hợp đồng.
- **Chi phí "ẩn" KHÔNG phải API:** ảnh/video (khách tự cung cấp hoặc thuê AI gen ~$0.05-0.20/ảnh-video),
  hosting n8n (~$5-20/mo VPS nếu self-host), tên miền lead form (nếu có).

---

## Khách cần CHUẨN BỊ gì (checklist tổng)

Trước khi bắt đầu, khách cần có sẵn:

- [ ] **Google account** (sở hữu Google Sheet lịch đăng + Drive chứa ảnh/video + Gmail nhận lead).
- [ ] **Facebook Page** + quyền Admin + 1 **Meta Business** (business.facebook.com).
- [ ] **Instagram Business/Creator account** (nếu muốn IG) — phải LINK vào FB Page.
- [ ] **Threads account** (nếu muốn Threads) — đăng nhập được, sẽ làm tester cho app.
- [ ] **LinkedIn account** (nếu muốn LinkedIn) — feed cá nhân.
- [ ] **X account + thẻ thanh toán** (CHỈ nếu muốn X — phải nạp credit).
- [ ] Ảnh/video bài đăng (khách tự chuẩn bị hoặc thỏa thuận AI-gen thêm phí).

---

## 1. Facebook Page — FREE

**Token model:** Page Access Token lấy qua **System User** (KHÔNG dùng Graph API Explorer — token đó chỉ
sống 1-2h). System-user token → `/me/accounts` → page token **never-expire, KHÔNG cần App Secret**.

**Khách chuẩn bị:**
1. FB Page (loại "New Pages Experience" hay classic đều được — endpoint publish giống nhau).
2. Meta Business (business.facebook.com) sở hữu Page đó.
3. Tạo **Meta App** (developers.facebook.com) loại Business.
4. **Business Settings → System Users** → tạo System User (vai Admin) → gán Page → **Generate token**:
   - Scope: `pages_manage_posts` + `pages_show_list` + `pages_read_engagement`.
   - Token này = page token never-expire. Lưu lại.
5. Lấy **Page ID** (Page → About → Page transparency, hoặc `GET /me/accounts`).

**Env cần điền:** `MKT_FB_PAGE_ID`, `MKT_FB_PAGE_ACCESS_TOKEN`.

**Bẫy thường gặp:**
- Token từ Graph API Explorer = short-lived → hết hạn giữa chừng. PHẢI dùng System User.
- `GET /me` trên page token phải trả về CHÍNH PAGE (name = tên page). Nếu trả về user → đang cầm
  system-user/user token, publish sẽ lỗi `(#200) must be posted as the page`.

---

## 2. Instagram — FREE (đi chung Facebook)

**Token model:** IG publish qua `graph.facebook.com/{IG_USER_ID}/media` dùng **CHUNG page token** của FB
(token phải có scope `instagram_content_publish`). KHÔNG dùng luồng Instagram-Login (IGAA/graph.instagram.com).

**Khách chuẩn bị:**
1. IG account phải là **Business hoặc Creator** (không phải Personal).
2. **Link IG vào FB Page** (FB Page → Settings → Linked accounts → Instagram).
3. Token FB page thêm scopes: `instagram_basic` + `instagram_content_publish` + `pages_show_list`.
4. Lấy **IG User ID:** `GET /{page-id}?fields=instagram_business_account` → trả về IG user id.

**Env cần điền:** `MKT_IG_USER_ID`, `MKT_IG_ACCESS_TOKEN` (= cùng giá trị page token).

**Cơ chế publish (2 bước):** tạo container (image_url public) → media_publish. Ảnh phải ở **URL public**
(Drive share "anyone with link" → `lh3.googleusercontent.com/d/{fileId}`).

---

## 3. Threads — FREE

**Token model:** long-lived **60 ngày**, refresh bằng `th_refresh_token`. App RIÊNG (không phải app FB).

**Khách chuẩn bị:**
1. Threads account.
2. Tạo app tại developers.facebook.com → thêm use-case **Threads API**.
3. Thêm Threads account làm **tester** → account đó phải **ACCEPT invite** (threads.net → Settings →
   Account → Website permissions → Invites). KHÔNG cần business verification cho self-publish ở dev mode.
4. Generate long-lived token (App Dashboard → Threads use case). Scope: `threads_basic` +
   `threads_content_publish`.
5. Lấy **Threads User ID** (`GET /me` trên token).

**Env cần điền:** `MKT_THREADS_USER_ID`, `MKT_THREADS_ACCESS_TOKEN`.

**Cơ chế publish (2 bước + permalink):** tạo container (media_type=IMAGE/VIDEO + URL public) → đợi ~35s →
threads_publish → GET media id để lấy permalink thật (publish chỉ trả id, không trả permalink).

---

## 4. LinkedIn (feed cá nhân) — FREE

**Token model:** OAuth 2.0, access token **60 ngày** + refresh token **365 ngày**. Dùng đường consumer
"Share on LinkedIn" (`/v2/ugcPosts` + `/v2/assets`) — chỉ cần scope `w_member_social`, KHÔNG cần company
verification.

> ⚠️ KHÔNG dùng đường versioned `/rest/posts` + `/rest/images` (Community Management API) — đường đó đòi
> **pháp nhân đăng ký + Partner verification**. Đăng feed cá nhân chỉ cần consumer v2.

**Khách chuẩn bị:**
1. LinkedIn account (feed cá nhân sẽ đăng lên).
2. Tạo app tại linkedin.com/developers/apps (phải gắn 1 LinkedIn Page bất kỳ — tạo tạm cũng được).
3. Tab **Products** → thêm **"Share on LinkedIn"** (cấp `w_member_social`) + **"Sign In with LinkedIn
   using OpenID Connect"** (để lấy person ID). Cả hai thường auto-approve.
4. Tab **Auth → OAuth 2.0 tools → Token Generator**: tick scope `w_member_social` + `openid` + `profile`
   → Generate → authorize → copy access token (sống 60 ngày, đủ test ngay, KHÔNG cần code OAuth flow).
5. Lấy **Person ID:** `GET /v2/userinfo` (Bearer token) → field `sub` = person ID.

**Env cần điền:** `MKT_LINKEDIN_PERSON_ID` (từ `sub`), `MKT_LINKEDIN_ACCESS_TOKEN`.

**Cơ chế publish ảnh (3 bước):** registerUpload (`/v2/assets`) → PUT binary lên uploadUrl → tạo post
(`/v2/ugcPosts`, shareMediaCategory=IMAGE, media=asset URN). Post URN trả về ở header `x-restli-id`.

---

## 5. X (Twitter) — TÍNH PHÍ 💰

**Sự thật 2026 (nói rõ với khách để khỏi hiểu lầm):**
- **KHÔNG còn free tier ghi** cho dev mới (bỏ từ 2/2026).
- **Basic $200/mo + Pro $5,000/mo** = legacy, đóng đăng ký mới, đã migrate sang pay-per-use từ 1/6/2026.
- **Pay-per-use (mặc định):** $0.015/post thường, **$0.20/post có link**, $0.005/read (cap 2M/tháng).
  Phải **nạp credit trước** mới gọi được API.
- Post có link bị X **bóp reach** → trả phí cao nhất cho loại post hiệu quả thấp nhất.

**Auth:** Bắt buộc **OAuth 2.0 user-context + PKCE** (app-only Bearer token KHÔNG post được). Token
user-context vẫn gửi dạng `Authorization: Bearer <user-token>`.

**Khách chuẩn bị (nếu quyết dùng X):**
1. X Developer account (developer.x.com → Free Account để có quyền dev, không phải tier post).
2. Tạo **Project → App**.
3. **User authentication settings:** App permissions = Read and write; Type = Web App; Callback URL =
   n8n callback (`http://localhost:5678/rest/oauth2-credential/callback`) hoặc URL test.
4. **Nạp credit** (Developer Console → Billing). Chưa nạp = mọi call post bị chặn.
5. Chạy OAuth2 PKCE flow lấy user-context token. Scope: `tweet.read tweet.write users.read media.write
   offline.access`.

**Env cần điền:** `MKT_X_ACCESS_TOKEN` (user-context token).

**Cơ chế publish:** upload media (`/2/media/upload`) → tạo tweet (`/2/tweets` với media_ids). 280 ký tự.
Video = chunked upload (INIT/APPEND/FINALIZE + poll STATUS) — phức tạp hơn ảnh.

**Khuyến nghị deal khách:** chỉ thêm X khi khách thực sự cần. Tính phí API X (theo lượng post) + phí vận
hành vào hợp đồng riêng, tách khỏi 4 nền free.

---

## Đăng VIDEO — lưu ý chung (mỗi nền một cơ chế)

Video KHÁC ảnh hẳn, không chỉ đổi field:

| Nền | Cơ chế video |
|-----|-------------|
| **Facebook** | `/{page}/videos`. Non-resumable (file_url/multipart): ≤1GB, ≤20 phút. Resumable API: ≤1.5GB, ≤45 phút (INIT/TRANSFER/FINISH). |
| **Instagram** | Reels container `media_type=REELS` + `video_url` public → poll `status_code=FINISHED` → publish. |
| **Threads** | `media_type=VIDEO` + `video_url` public → đợi xử lý → publish. |
| **LinkedIn** | `/rest/videos?action=initializeUpload`. >200MB phải MULTIPART_UPLOAD (chia part, thu ETag, hoàn tất). |
| **X** | `/2/media/upload` chunked: INIT → APPEND (từng chunk) → FINALIZE → poll STATUS → tạo tweet. |

→ Video adapter build riêng từng nền, không tái dùng image adapter. Khách cần video ở **URL public**
(IG/Threads) hoặc binary (FB/LinkedIn/X).

---

## Quy trình vận hành (sau khi setup xong)

Pipeline chạy bằng Google Sheet (control plane):

```
status=brief (product+angle, copy TRỐNG)
  → [copy-gen / Gemini] → status=review (copy đã sinh: copyVi/copyEn long-form + copyThreads English ≤480)
  → người duyệt: sửa nếu cần (status=rework để regen) HOẶC set status=ready + scheduledAt
  → [post-scheduler] → đăng đồng loạt các nền trong cột platforms → status=posted (+ postUrl)
```

- Cột `platforms` = danh sách nền, phẩy ngăn cách: `facebook,instagram,threads,linkedin,x`.
- Cột `heroFile` = tên file ảnh chính xác trong Drive folder (`driveFolderId`).
- Copy do **Gemini sinh tự động**, KHÔNG gõ tay. Người chỉ DUYỆT.
- Mỗi nền có IF-gate riêng → nền nào không có trong `platforms` thì bỏ qua, không lỗi.

---

## Bảo mật token (BẮT BUỘC khi deploy cho khách)

- Token lưu trong n8n credential vault hoặc `.env` của khách (mã hóa at-rest qua `N8N_ENCRYPTION_KEY`).
- **KHÔNG** commit token vào git. **KHÔNG** in giá trị token ra log.
- Mỗi install = token của CHÍNH khách (single-tenant). KHÔNG route post của nhiều khách qua 1 hệ thống
  (multi-tenant = kiến trúc khác: per-tenant isolation + KMS + Meta App Review).

---

Liên kết: `marketing-social-token-deployment.md` (chi tiết mint/verify token) ·
`marketing-test-preflight-checklist.md` (preflight 7 lớp trước mỗi lần test).
