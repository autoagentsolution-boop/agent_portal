# Phase B2 — WhatsApp Inbound Lead Adapter

**Priority:** HIGH · **Status:** pending · Depends: none (test number trước)

## Context
WhatsApp Cloud API FREE; **1000 inbound conversation/tháng MIỄN PHÍ**. User chưa có WABA → dùng **test number
Meta cấp** (dev mode) + số cá nhân làm test-recipient. Production number (chưa-dùng-WhatsApp) sau.

## Mục tiêu
User nhắn WhatsApp DAIS (từ CTA `wa.me/<number>`) → webhook inbound → n8n → leads tab (source=whatsapp).

## Key insights (verified)
- Cloud API không phí tháng; inbound (user nhắn trước) ~$0; chỉ outbound template tốn $0.016-0.02.
- Test: KHÔNG cần business number. Meta cấp test sender + tối đa 5 test recipient.
- Webhook inbound từ Meta servers → cần HTTPS public URL (n8n local cần tunnel/ngrok HOẶC reverse proxy).
- Webhook verify: Meta gửi GET với `hub.challenge` (verify token) + POST message events.

## Requirements
**Functional:** Meta webhook GET-verify + POST inbound message; n8n parse (from phone, name, text, wa_id);
upsert leads (source=whatsapp, phone, name, firstMessage); dedupe by phone.
**Non-functional:** GET-verify trả challenge đúng; idempotent (Meta retry); 24h window awareness (chỉ log lead,
không auto-reply marketing để tránh phí + ToS).

## Architecture
```
User → wa.me/<number> → nhắn tin → Meta Cloud API
  → webhook (GET verify hub.challenge / POST messages) → n8n /webhook/mkt-whatsapp
  → IF GET: return hub.challenge | IF POST: parse message → dedupe by phone → leads append → Gmail
```
⚠️ n8n local → cần public HTTPS cho Meta webhook. Options: Cloudflare tunnel / reverse proxy domain (cùng
domain Cal.com). Reuse domain từ B1.

## Related files
- CREATE: `n8n-workflows/mkt-whatsapp-lead.json` (webhook verify + inbound parse).
- MODIFY: `leads` tab — thêm cột phone (nếu chưa có), reuse source/firstMessage.
- CREATE: `docs/marketing-whatsapp-setup.md` (WABA dev setup + webhook + token).
- ENV: `MKT_WHATSAPP_VERIFY_TOKEN`, `MKT_WHATSAPP_APP_SECRET` (webhook signature), `MKT_WHATSAPP_PHONE_ID`.

## Implementation steps
1. Meta App → thêm product WhatsApp → lấy test number + token (dev). Add số cá nhân làm test recipient.
2. n8n webhook: handle GET (verify token → return hub.challenge) + POST (message events).
3. Verify X-Hub-Signature-256 (HMAC SHA256 app secret) — pure-JS (sandbox cấm crypto require).
4. Parse: entry[].changes[].value.messages[] → from (phone), contacts[].profile.name, text.body.
5. Dedupe by phone → leads append (source=whatsapp) → Gmail Sales.
6. Public HTTPS: reuse domain/reverse proxy (cùng Cal.com VPS) → /webhook/mkt-whatsapp.
7. Test: nhắn từ số cá nhân → verify leads row + email.

## Todo
- [ ] WABA dev: test number + token + test recipient
- [ ] Public HTTPS cho n8n webhook (tunnel/proxy)
- [ ] Webhook GET-verify + POST-parse
- [ ] Signature verify pure-JS
- [ ] Dedupe by phone + leads append + Gmail
- [ ] e2e test (nhắn → lead)
- [ ] docs/marketing-whatsapp-setup.md

## Success criteria
Nhắn WhatsApp từ số test → leads row source=whatsapp + phone + name; GET-verify pass; tin trùng không tạo
row mới.

## Risks
- Public HTTPS bắt buộc (Meta không gọi private IP, khác Cal.com). Tunnel/proxy phải ổn định.
- Production number: phải chưa-dùng-WhatsApp-thường → user chuẩn bị số riêng khi go-live.
- 24h window: KHÔNG auto-reply marketing template (tốn phí + ToS) — chỉ log lead.

## Security
- X-Hub-Signature-256 verify (constant-time). Verify token bí mật. Không log nội dung tin (PII).

## Next
B5 dynamic CTA dùng wa.me link. Pattern signature-verify dùng lại cho Zalo (B4).
