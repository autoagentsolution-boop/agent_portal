# Phase B1 — Cal.com Self-Host + Lead Webhook

**Priority:** HIGH (lead nền tảng, high-intent) · **Status:** pending · Depends: none

## Context
- Brainstorm: `plans/reports/brainstorm-260626-1530-content-factory-multichannel-leads.md`
- Loop B đã có: `n8n-workflows/mkt-lead-capture.json` (webhook→leads tab→Gmail, PASS A1-A5).
- Cal.com self-host CÙNG VPS với n8n (user chốt). n8n reach qua host gateway.

## Mục tiêu
Lead tự book meeting trên Cal.com → webhook `BOOKING_CREATED` → n8n → `leads` tab (cột meeting) + Gmail Sales.
Đóng vòng: post → CTA cal link → book → meeting (GCal + Meet) → lead logged.

## Key insights (verified)
- Cal.com = Next.js + Postgres, Docker. Min 2vCPU/4GB/20GB. Open-source FREE.
- Webhook `BOOKING_CREATED` ổn trên self-host (bug #16344 chỉ ảnh hưởng MEETING_STARTED/ENDED — không dùng).
- Self-host CHO PHÉP private IP webhook → n8n nội bộ nhận OK.
- Google Meet: connect per-account ở Settings → Apps.

## Requirements
**Functional:** Cal.com chạy Docker; event type "DAIS Demo" (requires confirmation); webhook → n8n; n8n parse
booking → upsert leads tab (email, name, source=calcom, meetingAt, meetUrl, calBookingUid, meetStatus).
**Non-functional:** webhook idempotent (Cal.com retry); secret verify; không chặn nếu Gmail fail.

## Architecture
```
Cal.com (Docker, cùng compose n8n hoặc compose riêng cùng VPS)
  → BOOKING_CREATED webhook (HMAC secret) → n8n webhook node /webhook/mkt-calcom
  → Verify secret → Parse booking payload → Dedupe (by email/calBookingUid)
  → Append/update leads tab → Gmail Sales notify
```
Cal.com Postgres: dùng DB riêng (KHÔNG chung videofarm Postgres — Cal.com tự quản schema).

## Related files
- CREATE: `n8n-workflows/mkt-calcom-lead.json` (webhook→leads), HOẶC mở rộng `mkt-lead-capture.json` thêm nhánh.
- MODIFY: docker-compose (thêm service cal.com + postgres-calcom) — file ở `n8n-local/` (user VPS).
- MODIFY: `leads` tab schema — thêm cột meetingAt/meetUrl/calBookingUid/meetStatus.
- CREATE: `docs/marketing-calcom-setup.md` (deploy steps + webhook config).

## Implementation steps
1. Deploy Cal.com: compose service + postgres-calcom + env (NEXTAUTH_SECRET, CALENDSO_ENCRYPTION_KEY,
   DATABASE_URL, domain, SMTP). `docker compose up -d`.
2. Cal.com setup: tạo admin, connect Google Calendar + Meet, tạo event type "DAIS Demo" (requires confirm).
3. Cal.com → Settings → Developer → Webhooks: add `BOOKING_CREATED`, URL = n8n webhook, secret.
4. n8n: webhook node → verify HMAC (pure-JS, task-runner sandbox cấm crypto — dùng XOR safeEq như lead-capture).
5. Parse Cal.com payload → map leads schema. Dedupe by calBookingUid (mỗi booking 1 lần).
6. Append leads tab (gsheets v4.7, columns.schema đầy đủ). Gmail Sales notify (onError continue).
7. Test: book thử trên cal link → verify leads row + email + GCal event + Meet link.

## Todo
- [ ] Cal.com compose + env + deploy
- [ ] Connect GCal/Meet + event type
- [ ] Webhook BOOKING_CREATED → n8n
- [ ] n8n parse + dedupe + leads append + Gmail
- [ ] leads tab thêm 4 cột meeting
- [ ] e2e test (book → lead logged)
- [ ] docs/marketing-calcom-setup.md

## Success criteria
Book thử → leads tab có row source=calcom + meetingAt + meetUrl; Gmail Sales nhận; GCal event + Meet tạo;
re-deliver webhook KHÔNG tạo row trùng.

## Risks
- VPS RAM: Cal.com ~4GB + n8n + Postgres. Verify VPS đủ (nếu không → Cal.com cloud free trước).
- SMTP: cần creds gửi email booking (Gmail app password / SendGrid).
- Bug #16344: tránh MEETING_STARTED/ENDED, chỉ BOOKING_CREATED.

## Security
- Webhook HMAC secret verify (constant-time, pure-JS). Không log payload chứa PII.
- Cal.com admin password mạnh; NEXTAUTH_SECRET + ENCRYPTION_KEY random.

## Next
B5 (dynamic CTA) dùng cal link làm CTA. B2/B3/B4 chat channels song song.
