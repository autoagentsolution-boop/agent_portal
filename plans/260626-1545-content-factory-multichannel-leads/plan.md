# Plan: Content Factory + Multi-Channel Lead Capture

Branch: pivot/video-content-farm · Created: 2026-06-26 · Status: PLANNING (chưa code)
Brainstorm gốc: `plans/reports/brainstorm-260626-1530-content-factory-multichannel-leads.md`

## Mục tiêu
Mở rộng marketing pipeline (đã có image 5/5 nền LIVE) theo 2 khối:
- **B (Lead):** đóng vòng thu lead đa kênh từ post → CÙNG `leads` tab (Loop B đã PASS A1-A5).
- **A (Content):** từ 1 narrative → infographic + storyboard 5 ảnh + video, per-product.

## Quyết định đã chốt (user 2026-06-26)
- Cal.com self-host **cùng VPS với n8n** (cần domain + SMTP).
- Product spec + brand assets **ĐÃ CÓ SẴN** → build Product Knowledge Base từ assets thật.
- WhatsApp: **test number Meta cấp** (dev mode) trước, production number sau. Số cá nhân làm test-recipient.
- Content factory: **tách folder `marketing-content-service/`** riêng, tái dùng render-service, thu gọn.
- SaaS readiness = MEDIUM (DAIS dùng tốt trước).
- Thứ tự lead: Cal.com → WhatsApp → Telegram → Zalo.

## Khuyến nghị thứ tự thực thi
Lead capture (B) trước — post đang chạy mà 0 đường thu lead = lãng phí reach. Content factory (A) sau.

## Phases

### Khối B — Lead Capture
| Phase | File | Status |
|-------|------|--------|
| B1 | [phase-01-calcom-selfhost-lead.md](phase-01-calcom-selfhost-lead.md) | pending |
| B2 | [phase-02-whatsapp-inbound-adapter.md](phase-02-whatsapp-inbound-adapter.md) | pending |
| B3 | [phase-03-telegram-bot-adapter.md](phase-03-telegram-bot-adapter.md) | pending |
| B4 | [phase-04-zalo-oa-adapter.md](phase-04-zalo-oa-adapter.md) | pending |
| B5 | [phase-05-dynamic-cta-copygen.md](phase-05-dynamic-cta-copygen.md) | pending |

### Khối A — Content Factory
| Phase | File | Status |
|-------|------|--------|
| A1 | [phase-06-marketing-content-service-scaffold.md](phase-06-marketing-content-service-scaffold.md) | pending |
| A2 | [phase-07-product-knowledge-base.md](phase-07-product-knowledge-base.md) | pending |
| A3 | [phase-08-infographic-agent.md](phase-08-infographic-agent.md) | pending |
| A4 | [phase-09-storyboard-5img-agent.md](phase-09-storyboard-5img-agent.md) | pending |
| A5 | [phase-10-video-agent.md](phase-10-video-agent.md) | pending |

## Dependencies
- B1 (Cal.com) độc lập, deploy được ngay.
- B2-B4 (chat channels) mỗi cái độc lập, dùng chung leads tab + dedupe mở rộng.
- B5 (dynamic CTA) phụ thuộc ≥1 kênh B1-B4 xong (cần link CTA thật).
- A1 (scaffold) phải xong trước A3-A5. A2 (KB) phải xong trước mọi content agent.
- A3 < A4 < A5 (độ khó + chi phí tăng dần; A4 storyboard là input cho A5 video).

## Hạ tầng dùng chung (đã có)
- n8n-local (container n8n-local-n8n-1), Postgres 172.17.0.1, Google Sheet control plane.
- `mkt-lead-capture.json` (Loop B, webhook→leads→Gmail, PASS).
- `render-service/` HTTP service (image/storyboard/tts) → nguồn tái dùng cho Khối A.

## Open items (không chặn planning)
- Domain + SMTP cho Cal.com (user cung cấp khi tới B1).
- Product KB: user chỉ đường dẫn brand assets khi tới A2.
