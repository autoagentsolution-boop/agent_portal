# Phase A4 — Storyboard 5-Image Agent

**Priority:** MEDIUM · **Status:** pending · Depends: A1 + A2 (+ A3 patterns)

## Context
5 ảnh nhất quán (nhân vật/style/brand) kể 1 câu chuyện. Phức tạp hơn infographic vì cần **consistency** xuyên
5 frame. Là input cho A5 video.

## Mục tiêu
Từ narrative + KB → storyboard 5 ảnh nhất quán → carousel post (FB/IG/LinkedIn hỗ trợ multi-image) hoặc
input cho video.

## Key insights
- Reference conditioning (Nano Banana Pro) giữ nhân vật/style nhất quán — đã verified ở video farm
  ([[project_storyboard_v2_pivot]]).
- render-service có `storyboard/adapter-v2 + schema-v2 + validate` → tái dùng cấu trúc panel.
- 5 frame = narrative chia 5 beat (hook → problem → solution → benefit → CTA). Mỗi beat 1 ảnh.
- Consistency = seed/reference chung + prompt mô tả nhân vật giống nhau mỗi frame.

## Requirements
**Functional:** /generate {assetType:storyboard, productId, narrative} → chia narrative thành 5 beat → gen 5
ảnh ref-conditioned → vision-verify mỗi ảnh → trả 5 URL theo thứ tự.
**Non-functional:** consistency check (nhân vật/brand nhất quán across 5); retry frame lỗi; thứ tự đúng.

## Architecture
```
POST /generate {assetType:storyboard, productId, narrative}
  → loadKB → split narrative → 5 beats (Gemini structured: hook/problem/solution/benefit/cta)
  → frame 1: nano-banana gen (brand + beat1) → set as reference
  → frame 2-5: nano-banana gen với reference=frame1 (consistency) + beat
  → vision-verify từng frame (brand + consistency)
  → upload 5 ảnh → trả [url1..url5] ordered
```
Tái dùng storyboard schema-v2 cho cấu trúc beat (trim food-specific).

## Related files
- CREATE: `marketing-content-service/src/agents/storyboard.ts`.
- REUSE: `src/storyboard/schema-v2.ts` (trim), `src/image/nano-banana.ts` (ref conditioning), vision-verify.
- MODIFY: `routes/generate.ts` dispatch storyboard.
- INTEGRATION: post-scheduler multi-image (FB attached_media, IG carousel, LinkedIn multi).

## Implementation steps
1. storyboard.ts: Gemini split narrative → 5 beat structured JSON.
2. Frame 1 gen (brand + beat1) → reference image.
3. Frame 2-5: ref-conditioned gen mỗi beat → consistency.
4. vision-verify mỗi frame (brand + nhân vật nhất quán) → retry frame fail.
5. Upload 5 → ordered URLs.
6. Test: AgentPortal narrative → 5 ảnh nhất quán, kể đúng câu chuyện.
7. post-scheduler: hỗ trợ multi-image (cần mở rộng adapter FB/IG/LinkedIn carousel — scope riêng).

## Todo
- [ ] storyboard.ts split 5 beat
- [ ] Frame 1 → reference
- [ ] Frame 2-5 ref-conditioned
- [ ] vision-verify consistency + retry
- [ ] Upload ordered URLs
- [ ] Test 5-frame nhất quán
- [ ] (sau) post-scheduler multi-image carousel

## Success criteria
Narrative → 5 ảnh: nhân vật/brand nhất quán, mỗi ảnh đúng beat, thứ tự đúng, vision-verify pass cả 5.

## Risks
- Consistency khó: ref conditioning không hoàn hảo → có thể cần seed lock + prompt kỹ. Chi phí retry cao (5 frame).
- Multi-image post: FB/IG/LinkedIn carousel = adapter mở rộng riêng (post-scheduler hiện single-image).
  → scope tách: gen storyboard trước, carousel post sau.

## Security
- Không secret mới.

## Next
A5 video: storyboard 5 ảnh → Veo i2v → clip có chuyển động + TTS + nhạc.
