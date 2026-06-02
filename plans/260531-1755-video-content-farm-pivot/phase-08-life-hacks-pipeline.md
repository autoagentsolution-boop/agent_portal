# Phase 08 — Life Hacks Pipeline

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-07](phase-07-news-comic-pipeline.md)
- Pexels API: https://www.pexels.com/api/documentation/
- Pixabay API: https://pixabay.com/api/docs/

## Overview
- **Priority:** Medium (simplest pipeline, học từ stock footage)
- **Status:** pending
- **Effort:** 1.5 days
- **Brief:** Cron 18:00 → Gemini "5 mẹo về {topic}" → per hack fetch Pexels footage by keyword → text overlay từng bước → TTS narration → render `HacksList` template → upload.

## Key Insights
- **Stock-based = near zero cost per video** ($0.02 chỉ tốn TTS + script LLM)
- **Pexels API rate limit**: 200 req/hour, 20k/month — overkill cho volume này
- **Topic rotation** 7-niche giống quiz: nấu ăn / dọn dẹp / tiết kiệm / sức khỏe / công nghệ / du lịch / làm đẹp
- **Text overlay style** cần đậm + outline để readable trên mọi footage

## Requirements

### Functional
- Cron 18:00 Asia/Bangkok
- Topic rotation by weekday
- Gemini prompt: 5 hacks JSON, mỗi hack có:
  ```
  { hack: "Tóm tắt 1 dòng", details: "Giải thích 1-2 câu", search_keywords: ["en keywords for stock"] }
  ```
- Pexels API search per hack → pick top 1 video clip (prefer 5-15s portrait orientation)
- Fallback: nếu Pexels không có portrait, dùng landscape + Remotion `transform: scale + crop`
- TTS narration: intro + 5 hacks + outro
- Render `HacksList` template (intro 3s + 5 hacks × 12s + outro 3s = ~66s)
- Upload với tags theo topic

### Non-functional
- Per video cost ≤ $0.03 (chỉ Gemini script)
- Render < 4 min
- Stock footage download cached locally `output/stock/{video_id}.mp4`

## Architecture

```
[Cron 18:00] → [Pick topic] → [Gemini 5 hacks JSON]
                                      ↓
                            [Postgres INSERT video_job]
                                      ↓
                            [Split: 5 hacks]
                       ┌──────────────┼──────────────┐
                       ▼              ▼              ▼
              [Pexels API search] [Edge TTS]   [Pixabay fallback]
              [download .mp4]
                       └──────────────┴──────────────┘
                                      ▼
                            [HTTP /render HacksList]
                                      ▼
                            [Sub-workflow upload]
```

## Hack Script Schema

```json
{
  "topic": "Mẹo dọn dẹp nhà bếp",
  "intro": "5 mẹo dọn nhà bếp nhanh chóng!",
  "hacks": [
    {
      "id": 1,
      "title": "Vỏ chanh khử mùi",
      "details": "Cho vỏ chanh vào máy xay rác chạy 30 giây để khử mùi hôi",
      "search_keywords": ["lemon peel", "kitchen cleaning", "garbage disposal"]
    }
  ],
  "outro": "Theo dõi để xem thêm mẹo hay!"
}
```

## Related Code Files
- **Create:** `n8n-workflows/life-hacks-pipeline.json`
- **Create:** `render-service/src/templates/hacks-list/` (HacksList.tsx + components)
- **Create:** `render-service/src/stock/pexels.ts` + `pixabay.ts` (search + download wrappers)
- **Modify:** `render-service/src/server.ts` add `/stock` route OR keep client-side in n8n via HTTP node

## Implementation Steps
1. Pexels API key free signup → `.env` `PEXELS_API_KEY=...`
2. Stock fetch wrapper:
   ```ts
   // pexels.ts
   POST /stock/pexels { keywords: string[], orientation: 'portrait' }
   - try keywords[0], if 0 results → keywords[1], ...
   - filter: duration >= 5s, video_files with quality='sd' or 'hd'
   - download first match → asset cache by hash(video_id)
   - return { path, duration }
   ```
3. Similar `pixabay.ts` fallback
4. `HacksList` Remotion template:
   - Intro: bold title + emoji
   - Per hack sequence: stock video bg + dark overlay 40% + number badge + hack title + details text (subtitle style)
   - Outro: subscribe CTA
   - Transitions: scale-zoom giữa hacks
5. Topics file `topics-hacks.json` (7 topics, 1/weekday)
6. n8n workflow build:
   - Cron → Topic pick → Gemini → DB INSERT → split 5 hacks → stock fetch + TTS parallel → aggregate → render → upload
7. Manual run 3x consecutive trên 3 topics khác nhau
8. Verify Pexels API attribution: footer text "Stock from Pexels" trong outro (license compliance)

## Todo List
- [ ] Pexels + Pixabay API keys trong `.env`
- [ ] `pexels.ts` wrapper + download + cache
- [ ] `pixabay.ts` fallback
- [ ] Gemini hack-script prompt + JSON validation
- [ ] `HacksList.tsx` template (intro + 5 hacks + outro)
- [ ] Topics rotation file
- [ ] n8n workflow build
- [ ] Pexels attribution trong outro
- [ ] 3 consecutive test runs với 3 topics
- [ ] E2E uploaded both platforms

## Success Criteria
- 3 consecutive runs, all uploaded successfully
- Cost per video < $0.05
- Pexels search: ≥ 4/5 hacks finds portrait clip, fallback ≤ 1
- Video readable trên phone screen (text contrast OK)

## Risk Assessment
- **Risk:** Pexels không có VN-context footage → **Accept:** generic footage OK cho hacks topics phổ quát
- **Risk:** Stock video aspect mismatch → **Mitigation:** Remotion `transform: scale` + center crop, padded với blurred bg
- **Risk:** Pexels TOS yêu cầu attribution → **Mitigation:** Outro text mention source
- **Risk:** Cùng stock clip dùng nhiều lần → user thấy quen → **Mitigation:** Cache by hash, nhưng 1 ngày 1 video × 7 topics × 5 clips = 35 clips/week → Pexels có hàng triệu, không lo

## Security Considerations
- Pexels API key trong env only
- Stock download path validation: chỉ allow `.mp4` extension, content-type check

## Next Steps
→ Phase 09: Multi-voice routing — pump variety qua Edge + Google Cloud TTS
