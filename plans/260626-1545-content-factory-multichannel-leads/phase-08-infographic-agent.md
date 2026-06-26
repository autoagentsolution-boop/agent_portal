# Phase A3 — Infographic Agent

**Priority:** MEDIUM (rẻ nhất, ROI nhanh) · **Status:** pending · Depends: A1 + A2

## Context
Asset đơn giản+rẻ nhất trong content factory. 1 ảnh data/layout per post. Bắt đầu Khối A từ đây.

## Mục tiêu
Từ narrative + Product KB → 1 infographic (data/layout đẹp, bám brand) → URL → post-scheduler dùng làm hero.

## Key insights
- 2 cách gen infographic:
  - **Gemini/Imagen image gen** (nhanh, 1 call, $0.02-0.06) — Nano Banana Pro render được text VN
    ([[feedback_pro_banana_renders_vn_text]]).
  - **HTML template → screenshot** (skill `design`, control layout chính xác, free render) — đẹp+nhất quán
    hơn cho data-heavy.
- Infographic data-heavy (số liệu, bullet, icon) → HTML template thường đẹp+đúng hơn pure image gen.
- KB brand.md cấp màu/font/logo → template/prompt bám brand.

## Requirements
**Functional:** /generate {assetType:infographic, productId, narrative} → đọc KB → gen infographic → trả URL
(upload Drive hoặc serve). 2 engine: image-gen HOẶC html-screenshot (chọn được).
**Non-functional:** vision-verify ảnh (đã có module) — check brand/text đúng trước khi trả; retry nếu fail.

## Architecture
```
POST /generate {assetType:infographic, productId, narrative}
  → loadKB(productId) → {brand, spec, refs}
  → engine:
     (A) nano-banana gen: prompt = narrative + brand + "infographic style" + ref conditioning
     (B) html-template: render data vào template brand → screenshot (chrome-devtools/puppeteer)
  → vision-verify (brand color, text readable, no garbage)
  → upload → URL → return
```

## Related files
- CREATE: `marketing-content-service/src/agents/infographic.ts`.
- REUSE: `src/image/nano-banana.ts` + `vision-verify.ts`.
- CREATE: `src/templates/infographic-*.html` (nếu dùng engine B).
- MODIFY: `routes/generate.ts` dispatch infographic.
- INTEGRATION: n8n → gọi service → URL về calendar `heroFile`/asset col.

## Implementation steps
1. infographic.ts: loadKB → build prompt (image-gen) HOẶC fill template (html).
2. Engine A (image-gen): nano-banana với ref conditioning + brand → ảnh.
3. Engine B (html): template brand + data narrative → puppeteer screenshot.
4. vision-verify: brand color present, text readable, không lỗi → pass/retry.
5. Upload Drive (public URL) → trả về.
6. routes/generate dispatch → test 1 narrative AgentPortal → verify ảnh đẹp + brand đúng.
7. n8n integration: workflow gọi service, ghi URL vào calendar row.

## Todo
- [ ] infographic.ts loadKB + gen
- [ ] Engine A (nano-banana + ref)
- [ ] Engine B (html template + screenshot) — chọn 1 hoặc cả 2
- [ ] vision-verify gate
- [ ] Upload + URL
- [ ] routes dispatch + test
- [ ] n8n integration

## Success criteria
1 narrative → infographic bám brand DAIS (màu/font/logo đúng), text đọc được, vision-verify pass; URL dùng
được trong post.

## Risks
- Image-gen text VN đôi khi lỗi → ưu tiên html-template cho data-heavy, image-gen cho visual-heavy.
- Chi phí gen + retry: cap số retry (đã có pattern ở video farm).

## Security
- Không secret mới. Drive upload reuse cred.

## Next
A4 storyboard 5 ảnh (phức tạp hơn — nhất quán nhân vật).
