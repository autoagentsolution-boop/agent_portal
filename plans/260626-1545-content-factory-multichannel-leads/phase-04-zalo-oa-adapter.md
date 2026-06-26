# Phase B4 — Zalo OA Lead Adapter

**Priority:** LOW (làm cuối) · **Status:** pending · Depends: none · Market: VN

## Context
Zalo Official Account (OA) cho thị trường VN. Khó nhất (cần OA verified). Làm cuối trong 4 kênh lead.
Chỉ ưu tiên nếu DAIS bán mạnh ở VN.

## Mục tiêu
User nhắn Zalo OA DAIS → webhook → n8n → leads tab (source=zalo).

## Key insights (cần verify khi build — Zalo docs đổi)
- Zalo OA cần đăng ký + verify (doanh nghiệp). Free tier có giới hạn tin/tháng.
- Open API: webhook event `user_send_text` / `user_send_*` → callback URL.
- Auth: OA access_token (refresh được), app_id + secret_key, verify bằng `mac` (HMAC).
- Cần public HTTPS callback (giống WhatsApp).

## Requirements
**Functional:** webhook nhận event user nhắn; verify mac signature; parse sender id + message; upsert leads
(source=zalo, zaloUserId); dedupe by zaloUserId.
**Non-functional:** access_token refresh (Zalo token hết hạn theo chu kỳ); idempotent.

## Architecture
```
User → Zalo OA → nhắn → Zalo platform
  → webhook callback (mac verify) → n8n /webhook/mkt-zalo
  → parse user_send_text → dedupe by zaloUserId → leads append (source=zalo) → Gmail
```
Public HTTPS reuse domain (cùng VPS Cal.com/WhatsApp).

## Related files
- CREATE: `n8n-workflows/mkt-zalo-lead.json`.
- MODIFY: `leads` tab — reuse source; zaloUserId.
- ENV: `MKT_ZALO_OA_TOKEN`, `MKT_ZALO_APP_SECRET`, `MKT_ZALO_OA_ID`.
- CREATE: `docs/marketing-zalo-setup.md`.

## Implementation steps
1. Đăng ký Zalo OA + verify doanh nghiệp (user-side, tốn thời gian duyệt).
2. Zalo Developer: tạo app, link OA, lấy app_id/secret + OA access_token.
3. Set webhook callback URL = n8n public + chọn events (user_send_text...).
4. n8n webhook: verify mac (HMAC) pure-JS → parse sender + message.
5. Dedupe by zaloUserId → leads append (source=zalo) → Gmail.
6. Token refresh: workflow phụ refresh OA access_token (giống Threads refresh pattern).
7. Test: nhắn OA → verify leads row.

## Todo
- [ ] Zalo OA đăng ký + verify (user)
- [ ] App + OA token + secret
- [ ] Webhook callback + events
- [ ] mac verify + parse
- [ ] Dedupe + leads append + Gmail
- [ ] Token refresh workflow
- [ ] e2e test
- [ ] docs/marketing-zalo-setup.md

## Success criteria
Nhắn Zalo OA → leads row source=zalo + zaloUserId; mac verify pass; trùng không tạo row mới.

## Risks
- OA verify duyệt lâu (doanh nghiệp) — user-side blocker, không build được tới khi OA active.
- Zalo docs/API hay đổi → research lại khi build.
- Token hết hạn → cần refresh workflow (như Threads).

## Security
- mac (HMAC) verify. Token trong $env/credential. Không log PII.

## Next
Kênh cuối. Sau B4 → mọi kênh lead đổ chung leads tab, attribution đầy đủ → B5 dynamic CTA hoàn chỉnh.
