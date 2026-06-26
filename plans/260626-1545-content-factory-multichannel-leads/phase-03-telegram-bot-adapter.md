# Phase B3 — Telegram Bot Lead Adapter

**Priority:** MEDIUM (free + dễ nhất) · **Status:** pending · Depends: none

## Context
Telegram Bot API FREE, không phí, setup dễ nhất trong 4 kênh. Bot trong ~1 ngày. Có thể làm TRƯỚC WhatsApp
nếu muốn proof-of-concept nhanh kênh chat.

## Mục tiêu
User mở `t.me/<bot>` → /start hoặc nhắn → webhook → n8n → leads tab (source=telegram).

## Key insights
- BotFather tạo bot → bot token (free). setWebhook trỏ về n8n public URL.
- Update object: message.from (id, username, first_name), message.text, message.chat.id.
- Webhook secret: setWebhook hỗ trợ `secret_token` → Telegram gửi header `X-Telegram-Bot-Api-Secret-Token`.
- Cần public HTTPS (giống WhatsApp) HOẶC dùng getUpdates polling (n8n Telegram Trigger node làm sẵn).

## Requirements
**Functional:** Telegram Trigger (n8n có node sẵn) HOẶC webhook; parse from/username/text; upsert leads
(source=telegram, telegramId, username); dedupe by telegramId; optional bot auto-reply "cảm ơn + link".
**Non-functional:** idempotent (update_id); secret_token verify nếu dùng webhook.

## Architecture
```
User → t.me/<bot> → /start | message → Telegram
  → (A) n8n Telegram Trigger node (polling, KHÔNG cần public URL)  ← KHUYẾN NGHỊ cho local
  → (B) webhook setWebhook + secret_token (cần public HTTPS)
  → parse → dedupe by telegramId → leads append (source=telegram) → Gmail
  → optional: bot sendMessage "cảm ơn, team sẽ liên hệ + cal link"
```
→ Dùng (A) Telegram Trigger node = KHÔNG cần public HTTPS (khác WhatsApp). Đơn giản nhất.

## Related files
- CREATE: `n8n-workflows/mkt-telegram-lead.json` (Telegram Trigger → leads).
- MODIFY: `leads` tab — reuse source; thêm telegramId/username nếu cần.
- ENV: `MKT_TELEGRAM_BOT_TOKEN`.
- CREATE: `docs/marketing-telegram-setup.md` (BotFather + n8n cred).

## Implementation steps
1. BotFather: /newbot → tên + username → copy bot token.
2. n8n: tạo Telegram credential (bot token). Telegram Trigger node (updates: message).
3. Parse update → from.id, from.username, from.first_name, text.
4. Dedupe by telegramId → leads append (source=telegram) → Gmail Sales.
5. Optional: Telegram sendMessage node auto-reply (cảm ơn + cal link CTA).
6. Test: mở bot, /start + nhắn → verify leads row + email.

## Todo
- [ ] BotFather tạo bot + token
- [ ] n8n Telegram credential + Trigger node
- [ ] Parse + dedupe by telegramId + leads append + Gmail
- [ ] Optional auto-reply
- [ ] e2e test
- [ ] docs/marketing-telegram-setup.md

## Success criteria
Nhắn bot → leads row source=telegram + username; update trùng không tạo row mới; (nếu bật) bot reply.

## Risks
- Telegram Trigger polling: 1 bot = 1 polling consumer. Nếu nhiều workflow cùng bot → xung đột. Giữ 1 workflow.
- Public URL không cần nếu dùng Trigger node (lợi thế lớn vs WhatsApp).

## Security
- Bot token trong n8n credential (không $env nếu dùng Trigger node — node tự quản).
- Nếu dùng webhook mode: secret_token verify.

## Next
B5 dynamic CTA dùng t.me link. Dễ nhất → có thể làm đầu tiên trong các chat channel để validate pattern.
