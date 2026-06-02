# Phase 07 — News→Comic Pipeline

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-06](phase-06-quiz-e2e-mvp.md)
- Nano Banana (Gemini Image): https://ai.google.dev/gemini-api/docs/image-generation

## Overview
- **Priority:** High (pipeline phức tạp nhất, học hỏi nhiều)
- **Status:** pending
- **Effort:** 2 days
- **Brief:** RSS scrape Vietnam news → Gemini summarize + chuyển thành 5-7 panel comic narrative → Nano Banana sinh 5-7 ảnh comic-style (consistent character via reference) → narration TTS → Remotion comic template → upload.

## Key Insights
- **Character consistency** là khó nhất với Nano Banana: dùng 1 reference image (mascot character) + edit mode để giữ style/visage qua mọi panel
- **News rewrite mạnh** tránh copyright — Gemini phải tóm tắt theo style hài/châm biếm, KHÔNG đọc nguyên văn
- **RSS Vietnam**: vnexpress.net/rss/tin-moi-nhat.rss, thanhnien.vn/rss/, dantri.com.vn/rss/home.rss — open RSS, không API key
- **Idempotent caching critical**: 5-7 images/video × $0.039 = ~$0.25/video. Cache miss = full cost. Hash key = sha256(prompt + reference_id)

## Requirements

### Functional
- Daily 12:00 cron pick 1 trending news
- Filter rules: tránh chính trị nhạy cảm, scandal cá nhân, tang lễ — chỉ news công nghệ/giải trí/lifestyle/khoa học
- Gemini summarize → 5-7 panel script với mỗi panel:
  ```
  { panel: 1, caption: "narration text", image_prompt: "comic-style description", character_present: bool }
  ```
- Nano Banana per panel:
  - If `character_present`: edit mode với reference image
  - Else: text-to-image
  - Hash cache check first
- TTS narration per panel
- Render `NewsComic` template (Phase 03 pattern)
- Upload via shared sub-workflow (Phase 05)

### Non-functional
- Generated images: 1080x1920 portrait (panel fills frame)
- Total render time < 5 min per video
- Cost per video: ≤ $0.40

## Architecture

```
[Cron 12:00] → [HTTP RSS fetch ×3 sources] → [Code: parse + filter + pick top]
                                                       ↓
                                          [Postgres INSERT video_job(pipeline='news_comic')]
                                                       ↓
                                          [Gemini: rewrite to comic script JSON]
                                                       ↓
                                          [Split: 5-7 panels]
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                  [Nano Banana per panel]    [Edge TTS per panel]
                                  (with cache check)
                                          └─────────────┬─────────────┘
                                                       ▼
                                              [HTTP /render NewsComic]
                                                       ▼
                                              [Sub-workflow upload]
```

## Comic Script Schema (Gemini output)

```json
{
  "title": "Tóm tắt 30 giây",
  "character_setup": "A young Vietnamese journalist-mascot with glasses, brown hair, casual shirt",
  "panels": [
    {
      "panel": 1,
      "caption": "Hôm nay có tin nóng...",
      "image_prompt": "comic panel, journalist character pointing at newspaper, surprised expression, vibrant colors",
      "character_present": true
    }
  ]
}
```

## Related Code Files
- **Create:** `n8n-workflows/news-comic-pipeline.json`
- **Create:** `render-service/src/templates/news-comic/` (NewsComic.tsx + helpers, mirror quiz structure)
- **Create:** `render-service/public/character-refs/journalist-mascot.png` (reference image, 1 lần manual gen với Nano Banana)
- **Create:** `render-service/src/image/nano-banana.ts` — wrapper với cache via Postgres `asset` table
- **Modify:** `render-service/src/server.ts` add `/image` route mirror `/tts/edge` pattern

## Implementation Steps
1. **Character reference**: manual gen ảnh mascot via Gemini Studio (1 lần), save `public/character-refs/journalist-mascot.png`
2. **Image route** `render-service`:
   ```ts
   POST /image
   Body: { prompt, mode: 'text-to-image'|'edit', referenceImage?: string, jobId }
   - hash = sha256(prompt + mode + referenceImage)
   - SELECT asset WHERE hash = ... → if hit, return cached path
   - Else: call Gemini Image API → save mp4/png → INSERT asset → return path
   ```
3. **RSS parsing**: n8n HTTP node fetch RSS → XML → Code node `xml2js` parse → flatten items → filter keywords (denylist: "tang lễ", "vụ án", "scandal", "chính trị"; allowlist categories from URL path)
4. **Comic script prompt**:
   ```
   Bạn là creator video hài tóm tắt tin tức. Tóm tắt tin sau thành kịch bản 6 panel comic NGẮN GỌN, HÀI HƯỚC, KHÔNG sao chép câu gốc. Character: {character_setup}. Mỗi panel có caption (lời thoại/dẫn 1-2 câu) và image_prompt (mô tả tiếng Anh cho AI image gen, comic style).
   Tin: {news_title}\n{news_body}
   JSON only, schema: {...}
   ```
5. **NewsComic template Remotion**:
   - Each panel: 4-5s (image fade in + caption appear + TTS narration)
   - Transitions: simple crossfade (Remotion `interpolate` opacity)
   - Background music low volume (Pexels free music)
6. **Niche denylist version v1**: hardcode trong workflow, refine sau ngày 1-2
7. **Wire to sub-workflow upload** với `tags=['comic','tin tức','tóm tắt']`

## Todo List
- [ ] Mascot reference image generated + saved
- [ ] `nano-banana.ts` wrapper với `asset` table cache
- [ ] `/image` route mounted + Zod validation
- [ ] RSS parse + filter logic (3 sources, denylist)
- [ ] Comic script Gemini prompt + JSON validation
- [ ] `NewsComic.tsx` template (5-7 panel sequence)
- [ ] BGM music asset (Pexels free, < 60s loop)
- [ ] n8n workflow build + manual test
- [ ] E2E: 1 news → 1 comic video → uploaded both platforms
- [ ] Cost audit: actual ≤ $0.40

## Success Criteria
- 5 consecutive runs: all produce coherent comic videos
- Character recognizable across panels (visual consistency ≥80% qua eyeball check)
- Cost per video: $0.20-0.40 typical
- Cache hit rate: >0 sau 3 chạy (same character ref hit)
- 0 panels có nội dung blacklist (tang lễ/scandal)

## Risk Assessment
- **Risk:** Nano Banana không giữ được character qua panels → **Mitigation:** Detailed `character_setup` prompt + reference image always passed + edit mode > text-to-image
- **Risk:** RSS feed format change → **Mitigation:** Try 3 sources, error→fallback
- **Risk:** Gemini summarize trùng câu gốc → copyright/spam strike → **Mitigation:** Prompt strict "KHÔNG sao chép câu gốc", manual review 2-3 ngày đầu
- **Risk:** Image API budget cháy (5-7 imgs × $0.039 × 30 days = $7-8/mo just for comic) → **Acceptable**, trong budget
- **Risk:** Sensitive news vẫn lọt qua filter → **Mitigation:** Phase 10 thêm semantic filter (Gemini classify trước)

## Security Considerations
- RSS sources: chỉ HTTPS, validate XML không có XXE (n8n parser OK)
- Image cache: filename = hash, không user input → safe
- Reference image: bundle in image, không user-supplied path

## Next Steps
→ Phase 08: Life hacks pipeline (simpler — stock footage không cần image gen)
