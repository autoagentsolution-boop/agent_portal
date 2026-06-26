# Brainstorm: Content Factory + Multi-Channel Lead Capture

Date: 2026-06-26 · Branch: pivot/video-content-farm · Status: design-only (chưa code)
Context: image pipeline 5/5 nền LIVE-verified xong. Giờ mở rộng 2 hướng theo vision user.

---

## Verified facts (research 2026-06-26)

### Cal.com self-host
- Next.js + Postgres, Docker. Min 2 vCPU / 4GB / 20GB. Open-source, **FREE** (chỉ tốn VPS).
- **Webhook `BOOKING_CREATED`** (+ cancelled/rescheduled/MEETING_STARTED/ENDED). Self-host CHO PHÉP private IP
  → n8n nội bộ nhận webhook OK.
- Google Meet: connect per-account ở Settings → Apps.
- ⚠️ Bug đã biết (#16344): self-host MEETING_STARTED/ENDED đôi khi không fire. BOOKING_CREATED thì ổn → ta
  chỉ cần cái này.

### WhatsApp Business Cloud API
- **Cloud API FREE** (không phí tháng). **1,000 inbound conversation/tháng MIỄN PHÍ**, reset đầu tháng.
- **Inbound = FREE** (user nhắn mình trước = "click-to-WhatsApp"). Chỉ tốn tiền khi MÌNH gửi template
  marketing ($0.016-0.02) — lead capture chỉ cần inbound → gần như $0.
- Webhook inbound message từ Meta servers. Cần WABA + verify number.

### Video farm tái dùng được (render-service đã là HTTP service)
- `render-service/src/`: **image/nano-banana.ts** (Nano Banana Pro gen + vision-verify), **storyboard/**
  (adapter-v2, motion-v2, schema-v2, validate), **tts/** (edge+gcloud+router), **audio/music-library**,
  **routes/** (image.ts, tts.ts, preflight.ts — đã expose HTTP).
- → Content factory KHÔNG build từ 0. Tái dùng render-service, thêm route/module cho marketing assets.

---

## KHỐI A — Content Factory (multi-format từ 1 narrative)

### Luồng hiện tại vs mở rộng
```
HIỆN TẠI:  brief → copy-gen (Gemini) → copyVi/copyEn/copyThreads/copyX → post (text + 1 hero image thủ công)
MỞ RỘNG:   brief → narrative → fan-out:
                                ├─ infographic (1 ảnh data/layout)
                                ├─ storyboard (5 ảnh nhất quán)
                                └─ video (từ storyboard → Veo)
```

### Kiến trúc đề xuất: tách `marketing-content-service` (folder riêng)

User muốn TÁCH khỏi video farm để sửa không ảnh hưởng. 2 lựa chọn:

| Cách | Mô tả | Trade-off |
|------|-------|-----------|
| **A. Folder mới `marketing-content-service/`** | Copy các module cần (nano-banana, tts, storyboard) sang service riêng, thu gọn cho marketing | Sạch, độc lập hẳn. Tốn công copy + maintain 2 bản nếu fix chung |
| **B. `render-service` thêm `src/marketing/`** | Cùng service, thêm namespace marketing + routes riêng | Tái dùng trực tiếp, 1 service. Nhưng "sửa ảnh hưởng project kia" — đúng cái user muốn tránh |
| **C. Monorepo package** | `render-service` thành lib, 2 app (video-farm + marketing) import | Sạch nhất kiến trúc, nặng setup nhất |

→ **Khuyến nghị A** (đúng yêu cầu user "tách folder, thu gọn"): `marketing-content-service/` copy 3 module
lõi (image gen, tts nếu cần audio, storyboard nếu cần video), bỏ phần video-farm-specific (cooking, bo-kho).
Marketing assets ngắn/rẻ hơn video farm → thu gọn được nhiều.

### Per-asset agent — "documentation đủ để gen cho từng product"

Đây là **insight quan trọng nhất**: vấn đề KHÔNG phải agent, mà là **Product Knowledge Base**. Mỗi agent
(infographic/storyboard/video) cần "product spec sheet" để gen đúng:

```
products/<product-id>/
  spec.md           # tính năng, USP, target audience, tone
  brand.md          # màu, font, logo path, visual style
  references/       # ảnh sản phẩm thật, screenshot UI, mockup
  examples/         # post mẫu đã duyệt (golden samples)
```

→ Agent đọc spec → gen asset bám brand. Đây là cái cho phép "gen cho từng product" mà không hard-code.
Giống cách copy-gen đọc `product` + `angle` từ Sheet, nhưng giàu context hơn.

### 3 asset-type (độ khó tăng dần)

| Asset | Cơ chế | Cost ước tính | Tái dùng |
|-------|--------|---------------|----------|
| **Infographic** (1 ảnh) | Gemini/Imagen gen HOẶC HTML template → screenshot (skill `design`) | $0.02-0.06 | nano-banana.ts |
| **Storyboard 5 ảnh** | 5 frame + reference conditioning (Nano Banana Pro, nhất quán nhân vật) | $0.10-0.30 | storyboard/ + nano-banana |
| **Video** | Storyboard → Veo i2v hoặc text2video → ghép + TTS + nhạc | $0.50-1.00+ | full render-service pipeline |

### Orchestration: n8n trigger → service, KHÔNG để n8n tự gen
n8n yếu ở gen-asset (state phức tạp, retry, ghép). Pattern:
```
n8n (cron, đọc Sheet) → HTTP POST marketing-content-service/generate
  → service fan-out (infographic/storyboard/video) → trả URL(s) về Sheet
  → post-scheduler đăng như hiện tại (asset = URL thay vì hero thủ công)
```
Tách orchestration nặng ra service = đúng pattern đã có với render-service.

---

## KHỐI B — Multi-Channel Lead Capture

### Vấn đề user chỉ ra: post chạy nhưng KHÔNG thu lead
CTA hiện tại = "link in bio" (mơ hồ). Cần đường thu lead thật từ post.

### Insight: tất cả là cùng 1 pattern (như 5-platform posting)
Mỗi kênh = 1 inbound webhook → đổ vào **CÙNG `leads` tab** (Loop B `mkt-lead-capture.json` đã PASS A1-A5).
Giống `results[]` của posting. Chỉ thêm **adapter inbound** per kênh.

### Thứ tự user chốt: Cal.com → WhatsApp → Telegram → Zalo

| # | Kênh | Cơ chế | Chi phí | Độ khó | CTA trong post |
|---|------|--------|---------|--------|----------------|
| 1 | **Cal.com** | self-host → webhook BOOKING_CREATED → leads tab + GCal/Meet | FREE (VPS) | Trung bình (deploy Docker) | cal link |
| 2 | **WhatsApp** | WABA Cloud API → webhook inbound message → leads | **FREE** inbound (1000/mo) | Trung bình (WABA verify) | `wa.me/<number>` |
| 3 | **Telegram** | Bot API → webhook /start hoặc message → leads | **FREE** | **Dễ nhất** | `t.me/<bot>` |
| 4 | **Zalo** | Zalo OA API → webhook → leads | FREE (OA) | Khó (OA verified, thị trường VN) | Zalo OA link |

### Mỗi adapter cần
- **Webhook receiver** (n8n webhook node, giống lead-capture hiện có).
- **Normalize → leads schema** (8 cột đã có: email/name/source/...). Mỗi kênh map field khác nhau
  (WhatsApp có phone+name, Telegram có username+chat_id, Cal.com có email+meetingAt).
- **Attribution:** cột `source` = kênh (whatsapp/telegram/zalo/calcom) để biết kênh nào ra lead.
- **Dedupe:** đã có (by email). Cần mở rộng dedupe theo phone/chat_id cho kênh chat.

### CTA động trong copy-gen
copy-gen hiện sinh "link in bio". Nâng cấp: nhét link kênh đúng vào CTA per-platform. Vd FB → wa.me link,
Threads → t.me link. Cần thêm cột `ctaChannel` hoặc map trong Build-X/Threads/etc request.

---

## Đề xuất roadmap (để user quyết)

### Phase L1 — Cal.com (lead nền tảng, high-intent)
Deploy Cal.com self-host (Docker) → webhook BOOKING_CREATED → mở rộng `mkt-lead-capture` nhận booking →
leads tab cột meetingAt/meetUrl. Đóng vòng post→book→meeting.

### Phase L2 — WhatsApp (inbound free, phổ biến nhất)
WABA setup → webhook inbound → leads. CTA post = wa.me. Lead nhắn tin trực tiếp.

### Phase L3 — Telegram (free, dễ — có thể làm trước L2 nếu muốn nhanh)
Bot → webhook → leads. Tech-savvy audience.

### Phase L4 — Zalo (VN market, để cuối)
Zalo OA → webhook → leads.

### Phase C1 — Content: Infographic (rẻ nhất, ROI nhanh)
marketing-content-service + product knowledge base + infographic agent. 1 ảnh data/layout per post.

### Phase C2 — Storyboard 5 ảnh
Reference-conditioned 5 frame. Tái dùng storyboard/ + nano-banana.

### Phase C3 — Video
Full pipeline. Đắt + chậm nhất. Cuối cùng.

---

## Câu hỏi mở (cần user trả lời để chốt plan)

1. **Cal.com deploy ở đâu?** Cùng VPS với n8n hay riêng? (cần domain + SMTP cho email booking)
2. **Product knowledge base** — DAIS có sẵn spec/brand assets chưa, hay phải tạo từ đầu cho product đầu tiên?
3. **WhatsApp number** — đã có WABA chưa, hay phải đăng ký mới? (cần số phone chưa dùng WhatsApp thường)
4. **CTA strategy** — 1 kênh CTA chính cho mọi post, hay mỗi platform 1 kênh khác nhau?
5. **Thu gọn video farm** — chấp nhận bỏ phần nào (cooking-specific, bo-kho samples) khi copy sang marketing
   content service?

---

## Trade-off lớn nhất cần align trước khi build

**Lead capture (Khối B) vs Content factory (Khối A) — cái nào ROI cao hơn NGAY BÂY GIỜ?**

- Post ĐANG chạy 5 nền nhưng **0 đường thu lead** → mỗi post hiện tại = lãng phí reach. Lead capture đóng
  vòng tiền ngay.
- Content factory làm post ĐẸP hơn nhưng nếu không thu được lead thì đẹp cũng không ra tiền.

→ Khuyến nghị: **Khối B (lead) trước, ít nhất 1-2 kênh**, rồi Khối A. Nhưng user muốn brainstorm align toàn
bộ trước — doc này là input cho quyết định đó.
