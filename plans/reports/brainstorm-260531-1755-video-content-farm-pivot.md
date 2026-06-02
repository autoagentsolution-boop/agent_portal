---
title: Pivot AgentPortal → Local Video Content Farm Agent
date: 2026-05-31
type: brainstorm-summary
status: design-approved-pending-plan
---

# Pivot AgentPortal → Local Video Content Farm Agent

## 1. Problem Statement

AgentPortal hiện không còn phù hợp định hướng nhà đầu tư. Pivot thành **personal local agent** tự động hóa toàn bộ pipeline: sinh script → sinh ảnh/video → ghép → upload YT Shorts + FB Reels để cày view. Budget cứng: **< 1tr VND/tháng (~$40)**.

## 2. Requirements

### Functional
- Đa-pipeline output:
  1. **Quiz/Gameshow** — câu hỏi nhanh theo chủ đề/event
  2. **News → Comic strip** — tin nóng VN convert sang ảnh hài, narration ngắn
  3. **Life hacks / Mẹo vặt** — slideshow + voiceover
- Tự động: schedule → gen → upload không cần người
- Multi-voice TTS (variety qua nhiều giọng)
- Volume: 1-3 video/ngày, 1 niche

### Non-functional
- Setup nhẹ (CPU 16GB, không GPU local)
- Cost ≤ 1tr VND/mo
- Tái dùng Docker stack (n8n + Postgres) có sẵn
- Có thể scale lên GPU thuê sau
- Timeline MVP: 2 tuần

### Constraints
- Không có GPU local
- Code AgentPortal cũ: đập đi xây lại, giữ Docker compose + n8n folder
- YouTube/FB anti-spam → cần varied templates, original rewrite

## 3. Evaluated Approaches

| Option | Stack | Cost/mo | Setup | Verdict |
|---|---|---|---|---|
| A | n8n + Remotion render service (Docker) | $18-30 | 4-6 ngày MVP/14 full | **✅ Chosen** |
| B | Python CLI + cron, n8n chỉ upload | $18-30 | 3-4 ngày | Loại — mất visual workflow + OAuth manager n8n |
| C | SaaS (Vadoo/InVideo) hybrid | $30-45 | 1-2 ngày | Loại — vendor lock, không làm được comic-from-news, ngốn 60% budget |

### Tại sao A
- n8n đã có Docker — không tốn setup
- OAuth credential cho YT/FB là pain point lớn nhất, n8n xử lý native
- Tách render service riêng → swap CPU↔GPU sau này chỉ đổi 1 endpoint
- Postgres lưu job state + history (DR, replay được)

## 4. Final Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  n8n (Docker, port 5678)                                    │
│  ├─ Workflow: quiz-pipeline      [schedule: daily 08:00]    │
│  ├─ Workflow: news-comic-pipeline [schedule: daily 12:00]   │
│  ├─ Workflow: life-hacks-pipeline [schedule: daily 18:00]   │
│  └─ Workflow: youtube/facebook-upload [shared sub-workflow] │
└──┬──────────────────────────────────────────────────────────┘
   │ HTTP webhook (internal)
   ▼
┌─────────────────────────────────────────────────────────────┐
│  render-service (Node + Remotion, Docker)                   │
│  POST /render { template, props } → returns mp4 path        │
│  Templates: QuizCountdown, NewsComic, HacksList             │
└─────────────────────────────────────────────────────────────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
   [Gemini]      [Nano Banana]   [Edge/GCloud   [Pexels/
   2.5 Flash    + reference img    TTS]          Pixabay]
   script         comic panels
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Postgres (Docker)                                          │
│  Tables: video_job, asset, upload_target, run_log           │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline detail

**Quiz pipeline (cost/video ~$0.05)**
1. n8n cron 08:00 → call Gemini "Tạo 10 câu quiz về {topic_of_day}"
2. Edge TTS đọc từng câu + countdown SFX
3. Remotion render `QuizCountdown.tsx` với props {questions, voices}
4. Upload YT Shorts + FB Reels qua n8n OAuth nodes
5. Log job ID + URLs về Postgres

**News-comic pipeline (cost/video ~$0.35)**
1. n8n cron 12:00 → scrape RSS (vnexpress + thanhnien)
2. Gemini pick top 1 news, rewrite thành 5-7 panel comic narrative
3. Nano Banana gen 5-7 panel images (consistent character qua reference image)
4. TTS narration per panel
5. Remotion `NewsComic.tsx` ghép
6. Upload + log

**Life hacks pipeline (cost/video ~$0.02)**
1. n8n cron 18:00 → Gemini "5 mẹo về {topic}"
2. Pexels API fetch relevant footage per hack
3. Edge TTS đọc
4. Remotion `HacksList.tsx` overlay text + b-roll
5. Upload + log

### Multi-voice strategy (thay HeyGen)

⚠️ **HeyGen $99/mo vượt budget** — không recommend. Thay bằng:

| Tool | Cost | Số giọng VN | Use case |
|---|---|---|---|
| Edge TTS | Free | 9 giọng neural (HoaiMy, NamMinh, etc) | Default cho mọi pipeline |
| Google Cloud TTS | $4/1M chars (~$0.5/mo) | 7 WaveNet/Neural2 voices | Variety pool, mix với Edge |
| Cartesia Sonic 2 | ~$5/mo low volume | Multilingual, expressive | Premium narration cho news-comic |
| ElevenLabs Starter | $5/mo, 10k chars | Multilingual v2, voice clone | Optional cho 1-2 video viral/tuần |

**Recommend**: Edge TTS + Google Cloud TTS → đã có 16 giọng, total $0.5/mo. Switch case theo content type + character role → người xem cảm giác variety.

## 5. Cost Breakdown (Monthly, worst case 3 video/ngày × 30)

| Item | Volume | Unit cost | Subtotal |
|---|---|---|---|
| Gemini 2.5 Flash (scripts) | 90 calls × 3k tokens | $0.30/1M output | ~$1 |
| Nano Banana (comic news only, ~30 vid × 6 imgs) | 180 imgs | $0.039 | $7 |
| Nano Banana (cover/hook other, ~60 vid × 1 img) | 60 imgs | $0.039 | $2.30 |
| Google Cloud TTS | ~150k chars | $4/1M | $0.60 |
| Edge TTS | unlimited | Free | $0 |
| Pexels/Pixabay | unlimited | Free | $0 |
| Render service (CPU local) | — | — | $0 |
| n8n + Postgres (Docker local) | — | — | $0 |
| YT Data API | within 10k quota/day | — | $0 |
| FB Graph API | — | — | $0 |
| **Total** | | | **~$11/mo (~280k VND)** |

**Buffer:** ElevenLabs Starter $5 + thử nghiệm Veo 3 Fast cho 5 viral clips/tháng $5 → vẫn dưới $25 (~625k VND).

✅ **Budget safe.** Có dư ~40% để thí nghiệm.

## 6. Implementation Plan Outline (2 tuần)

### Week 1 — Foundation + Quiz Pipeline (MVP)
- **D1**: Tear down portal code (giữ docker-compose + n8n volume), tạo repo skeleton mới
- **D2**: render-service scaffold (Node + Remotion + Express webhook)
- **D3**: Template `QuizCountdown.tsx`, thử render mp4 thủ công
- **D4**: n8n workflow `quiz-pipeline` (script gen + TTS + render call)
- **D5**: YT + FB OAuth setup trong n8n, sub-workflow upload
- **D6-7**: E2E quiz: 1 video tự động lên YT/FB

### Week 2 — News-Comic + Life Hacks + Polish
- **D8-9**: News-comic pipeline (RSS scrape, Nano Banana với reference img cho character consistency, NewsComic template)
- **D10-11**: Life hacks pipeline (Pexels integration, HacksList template)
- **D12**: Multi-voice routing logic, Cartesia/ElevenLabs integration optional
- **D13**: Postgres logging + minimal CLI dashboard (`npm run status`)
- **D14**: Hardening — retry, FB token refresh, render queue, cold-start test

### Phase out post-MVP
- Analytics: pull view count từ YT/FB API → Postgres → simple chart
- A/B template variants
- Multi-niche support (tag-based scheduling)
- GPU rental khi scale (swap Nano Banana → ComfyUI/SDXL on Runpod)

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| YT/FB ban vì repetitive content | High | ≥2 template variants per pipeline, original rewrite từ source, varied voice |
| FB Page token expire (60-90 ngày) | Medium | n8n credential refresh job hàng tuần, alert qua email |
| YT quota 10k/day giới hạn upload | Low | Volume 1-3/ngày OK, request quota tăng khi scale |
| Nano Banana cost spike khi prompt fail/retry | Medium | Idempotent cache: hash(prompt) → image, retry không tái gen |
| Render CPU bottleneck 3 video cùng giờ | Medium | n8n queue serialize, hoặc lệch schedule 4h |
| Vietnam news scraping bị block | Medium | Multi-source RSS, fallback Gemini search grounding |
| Vendor outage (Gemini) | Low | Workflow có error path → email alert, không tự retry quá 3 lần |
| Account safety strike | High | Watermark, không clickbait, tránh copyright music — dùng Pexels music free |

## 8. Success Metrics

### Technical (sprint-end)
- [ ] 3 pipelines deploy được, mỗi pipeline tạo 1 video/ngày tự động ≥7 ngày liên tiếp không fail
- [ ] Cold start: `docker compose up` → MVP video lên kênh trong 1h không cần touch code
- [ ] Cost actual ≤ $20/mo (~500k VND) trong tháng đầu

### Business (30 ngày sau live)
- [ ] ≥90 video lên kênh
- [ ] YT/FB không strike
- [ ] Đạt ≥1 video có >1k view (proof of concept)

## 9. Open Questions / Defer

1. **Niche cụ thể?** — chưa quyết. Recommend chọn 1 broad niche cho mỗi pipeline (vd: quiz về địa lý VN; news-comic về công nghệ; mẹo vặt nhà bếp). Quyết trong week 1.
2. **Multi-account chiến lược?** — chưa cần ở phase này. Cân nhắc sau 30 ngày nếu 1 channel growth chậm.
3. **Monetization mục tiêu?** — chưa scope (YT Partner cần 1k sub + 4k watch hrs). Tập trung view trước, kiếm tiền sau.
4. **Voice cloning của 1 character cố định?** — defer. Edge + GCloud variety đủ trong MVP. Cân nhắc ElevenLabs voice clone post-MVP.
5. **Localization** — chỉ tiếng Việt phase này. EN content cân nhắc sau.

## 10. Next Steps

1. Nếu approve → invoke `/ck:plan` với context của doc này để sinh phase plan chi tiết trong `plans/260531-1755-video-content-farm-pivot/`
2. Quyết định niche cụ thể cho mỗi pipeline (cần input từ user)
3. Apply for YT Data API access (nếu chưa có) + tạo FB Page + token
4. Archive code portal cũ (tag git `archive/agent-portal-demo`) trước khi xóa
