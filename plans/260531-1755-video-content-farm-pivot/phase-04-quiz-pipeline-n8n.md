# Phase 04 — Quiz Pipeline n8n Workflow

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-03](phase-03-quiz-countdown-template.md)
- Edge TTS docs: https://github.com/rany2/edge-tts

## Overview
- **Priority:** Critical (chuỗi orchestration đầu tiên)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** n8n workflow: cron 08:00 → Gemini generate 10 câu quiz → Edge TTS đọc từng câu → POST /render → store outputs vào `video_job`. Upload bước sau (Phase 05).

## Key Insights
- **n8n HTTP Request node** đủ cho Gemini API (không cần community node)
- **Edge TTS không có official API** — gọi qua subprocess `edge-tts` CLI hoặc service nội bộ. Solution: thêm 1 nhỏ endpoint trong render-service `/tts/edge` wrap subprocess (simpler than separate service)
- **Niche picker**: simple JSON file `niches.json` rotate theo day-of-week
- **Idempotency**: jobId = uuid generate ở start, dùng làm key cho mọi step

## Requirements

### Functional
- Cron trigger daily 08:00 (Asia/Bangkok)
- Pick niche từ rotating list (vd: Mon=lịch sử VN, Tue=địa lý, Wed=khoa học, ...)
- Call Gemini 2.5 Flash với prompt template generating 10 quiz questions JSON
- Validate Gemini output (4 options exactly, correctIndex 0-3) — retry 1 lần nếu schema sai
- TTS từng câu (question + reveal text), lưu mp3 paths
- INSERT `video_job` row, capture jobId
- POST `render-service:7000/render` với template=`QuizCountdown`
- UPDATE `video_job.video_path` + status=`rendered`
- KHÔNG upload trong phase này (Phase 05+06 wire upload)

### Non-functional
- Workflow timeout 10 min
- On any error: write `run_log`, mark `video_job.status='failed'`, alert via webhook (placeholder)
- Workflow exported JSON commit vào `n8n-workflows/quiz-pipeline.json`

## Architecture

```
[Cron 08:00] → [Pick niche] → [HTTP Gemini API] → [Code: validate + parse]
                                                            ↓
                                              [Postgres INSERT video_job]
                                                            ↓
                                              [Split: loop 10 questions]
                                                            ↓
                                              [HTTP /tts/edge per question]
                                                            ↓
                                              [Aggregate audio paths]
                                                            ↓
                                              [HTTP /render]
                                                            ↓
                                              [Postgres UPDATE video_job]
```

## Gemini Prompt Template

```
Bạn là creator quiz video. Sinh CHÍNH XÁC 10 câu hỏi trắc nghiệm về chủ đề: "{niche}".
Mỗi câu 4 lựa chọn, 1 đáp án đúng. Câu hỏi ngắn (<15 từ), thú vị, không quá dễ.
Trả về JSON đúng schema:
{
  "title": "...",
  "questions": [
    { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }
  ]
}
KHÔNG markdown, KHÔNG comment, JSON thuần.
```

## Related Code Files
- **Create:** `n8n-workflows/quiz-pipeline.json` (export), `n8n-workflows/niches.json`, `render-service/src/tts/edge.ts`, `render-service/src/routes/tts.ts`
- **Modify:** `render-service/src/server.ts` mount `/tts/edge` route

## Implementation Steps
1. Trong render-service, add `/tts/edge` endpoint:
   ```ts
   // POST /tts/edge { text, voice: 'vi-VN-HoaiMyNeural', jobId }
   // returns { audioPath, durationMs }
   // implementation: spawn `edge-tts --voice $voice --text "$text" --write-media output/{jobId}-{hash}.mp3`
   // cache by hash(text+voice) → if exists, return cached
   ```
2. Test edge-tts CLI standalone: `pip install edge-tts; edge-tts --voice vi-VN-HoaiMyNeural --text "Xin chào" --write-media test.mp3`
3. Embed edge-tts vào Dockerfile (`apt-get install python3-pip && pip install edge-tts`)
4. Tạo `niches.json`:
   ```json
   [
     {"day": 1, "niche": "Lịch sử Việt Nam thời phong kiến"},
     {"day": 2, "niche": "Địa lý các tỉnh Việt Nam"},
     ...
   ]
   ```
5. Trong n8n, build workflow node by node:
   - **Cron**: daily 08:00 Asia/Bangkok
   - **Set** node: pick niche by `new Date().getDay()`
   - **HTTP**: POST Gemini API với prompt template, header `x-goog-api-key: {{$env.GEMINI_API_KEY}}`
   - **Code (JS)**: `JSON.parse(items[0].json.candidates[0].content.parts[0].text)`, validate schema, throw if invalid
   - **Postgres node**: INSERT video_job RETURNING id
   - **SplitInBatches**: 10 questions
   - **HTTP /tts/edge** per question (question text + reveal text)
   - **Aggregate**: merge audio paths back vào quiz props
   - **HTTP /render**: POST với template=QuizCountdown, jobId, full props
   - **Postgres**: UPDATE video_job SET video_path=..., status='rendered'
6. Error trigger: on any node error, INSERT run_log + UPDATE status='failed'
7. Export workflow JSON, commit vào `n8n-workflows/`
8. Manual test: trigger workflow on demand, inspect Postgres rows + output mp4

## Todo List
- [ ] `render-service` add `/tts/edge` endpoint với cache
- [ ] Edge-tts Python CLI vào Dockerfile
- [ ] `niches.json` 7 niches (1 per weekday)
- [ ] n8n workflow draft (Cron → Gemini → validate → DB → TTS loop → render → DB)
- [ ] Error handling node wired to `run_log`
- [ ] Manual trigger end-to-end → mp4 file
- [ ] Export workflow JSON to repo
- [ ] Verify Postgres rows: 1 video_job + N run_log + assets cached

## Success Criteria
- Workflow chạy manual trigger 1 lần → mp4 60s output thành công
- `video_job.status='rendered'`, video_path không null
- Gemini retry logic: schema invalid → retry 1 lần → fail hard nếu vẫn sai
- Assets cache: chạy lại cùng niche cùng ngày → TTS hit cache, skip API

## Risk Assessment
- **Risk:** Gemini output JSON malformed (extra text/markdown) → **Mitigation:** Strip code-fence in Code node, retry với "STRICT JSON, no markdown" reminder
- **Risk:** Edge TTS CLI fail intermittent → **Mitigation:** Subprocess retry 2x with 1s delay
- **Risk:** n8n cron miss khi container restart → **Mitigation:** n8n catchup setting, document trong README
- **Risk:** Niche file stale → **Mitigation:** Phase 11 thêm `npm run niches:add`

## Security Considerations
- `GEMINI_API_KEY` chỉ trong n8n env, không log
- `/tts/edge` validate text length (< 500 chars) tránh DoS
- Subprocess command — KHÔNG dùng string concatenation, dùng `spawn(cmd, [args])` array

## Next Steps
→ Phase 05: YT + FB OAuth setup + upload sub-workflow (reusable cho cả 3 pipelines)
