# Phase A2 — Product Knowledge Base

**Priority:** HIGH (input cho MỌI content agent) · **Status:** pending · Depends: A1 scaffold

## Context
Insight cốt lõi từ brainstorm: content factory KHÔNG phải vấn đề "agent" — mà là **Product Knowledge Base**.
Mỗi product cần spec để agent gen asset đúng brand/USP. User xác nhận DAIS **đã có sẵn** brand + product
assets → build KB từ assets thật.

## Mục tiêu
Cấu trúc KB per-product để content agent (infographic/storyboard/video) đọc → gen on-brand, on-message.
Không hard-code product vào agent.

## Key insights
- copy-gen hiện đọc product+angle từ Sheet (nghèo context). KB giàu hơn: brand color/font/logo, USP, ảnh
  tham chiếu, golden samples.
- KB = nguồn sự thật cho cả copy LẪN visual. Có thể copy-gen tương lai cũng đọc KB (thay vì chỉ product string).
- Reference images (ảnh sản phẩm thật, screenshot UI) = điều kiện để gen visual bám thực tế (Nano Banana
  reference conditioning đã verified ở video farm — [[feedback_pro_banana_renders_vn_text]]).

## Requirements
**Functional:** structure `products/<id>/` với spec.md + brand.md + references/ + examples/; loader đọc KB →
context object cho agent; validate KB đầy đủ trước gen.
**Non-functional:** thêm product mới = thêm 1 folder (không code); KB versioned trong git (trừ ảnh lớn).

## Architecture
```
marketing-content-service/src/products/
  agentportal/
    spec.md        # tính năng, USP, target audience, tone of voice, key messages
    brand.md       # màu (hex), font, logo path, visual style, do/don't
    references/    # ảnh sản phẩm thật, screenshot UI, mockup dashboard
    examples/      # post mẫu đã duyệt (golden samples) — text + visual
  <product-2>/...

src/products/loader.ts → đọc <id>/ → { spec, brand, refImages[], examples[] }
```

## Related files
- CREATE: `marketing-content-service/src/products/agentportal/` (product đầu tiên).
- CREATE: `src/products/loader.ts` (đọc + validate KB).
- CREATE: `src/products/schema.ts` (type cho spec/brand).
- INPUT (user cung cấp): brand assets DAIS đã có → đổ vào references/.

## Implementation steps
1. Định nghĩa schema spec.md + brand.md (markdown + frontmatter HOẶC structured md).
2. loader.ts: đọc folder → parse spec/brand → load references/ (path list) → examples/.
3. validate.ts: KB đủ field bắt buộc trước khi cho gen (tránh gen rác).
4. Tạo `agentportal/` từ assets DAIS thật (user chỉ đường dẫn brand guideline + ảnh).
5. Test loader: load agentportal → in ra context object đầy đủ.

## Todo
- [ ] Schema spec.md + brand.md
- [ ] loader.ts đọc + parse KB
- [ ] validate.ts (KB đủ field)
- [ ] Tạo products/agentportal/ từ assets DAIS thật
- [ ] Test loader output

## Success criteria
loader đọc agentportal/ → context object có spec + brand + ≥1 reference image + ≥1 example; validate fail nếu
thiếu field bắt buộc.

## Risks
- Assets DAIS chưa đủ chất lượng cho gen (ảnh thấp res, brand mơ hồ) → user cần chuẩn bị kỹ.
- Over-engineering KB: bắt đầu tối thiểu (spec + brand + vài ref), mở rộng khi cần.

## Security
- Không secret. Brand assets có thể nhạy cảm (logo chưa public) → cân nhắc gitignore references nếu cần.

## Next
A3 infographic agent đọc KB này. A4/A5 cũng dùng cùng KB.
