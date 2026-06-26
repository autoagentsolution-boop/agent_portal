# Phase B5 — Dynamic CTA trong copy-gen (link kênh thật vào post)

**Priority:** HIGH (kết nối post ↔ lead) · **Status:** pending · Depends: ≥1 kênh B1-B4

## Context
copy-gen hiện sinh CTA mơ hồ ("link in bio"). Sau khi có kênh lead thật (cal/wa.me/t.me/zalo), post phải
nhét **link kênh đúng** vào CTA để lead bấm → đổ về leads tab. Đây là mảnh nối post (5 nền) ↔ lead (4 kênh).

## Mục tiêu
copy-gen sinh CTA chứa link kênh thật, per-platform phù hợp (FB→wa.me, Threads→t.me, v.v.) thay vì "link in
bio". Link cấu hình được, không hard-code.

## Key insights
- copy-gen đã sinh copyVi/copyEn/copyThreads/copyX. CTA nằm cuối mỗi bản.
- X tính phí $0.20 nếu URL THẬT trong text → X giữ "link in bio" (link ở profile), KHÔNG nhét URL.
- FB/IG/Threads/LinkedIn nhét link OK (không phí theo link).
- Link kênh = config (Sheet column hoặc env), copy-gen đọc → chèn vào prompt.

## Requirements
**Functional:** thêm config link kênh (vd cột `ctaLink` hoặc env per-channel); copy-gen chèn link đúng vào
CTA của copyVi/copyEn/copyThreads (KHÔNG copyX — X né phí link); per-platform có thể khác link.
**Non-functional:** không phá copy hiện tại; X vẫn "link in bio".

## Architecture
```
Sheet row: thêm cột ctaLink (vd https://wa.me/<n>) HOẶC ctaChannel (whatsapp→map env link)
  → copy-gen Build Gemini request: chèn "CTA dẫn về {ctaLink}" vào prompt cho copyVi/copyEn/copyThreads
  → copyX prompt GIỮ "link in bio" (tránh $0.20)
  → post như cũ, link thật trong text các nền không-phí
```

## Decision cần chốt (open)
- **1 link chung mọi nền** hay **mỗi platform 1 kênh**? (user chưa chốt — câu hỏi mở từ brainstorm)
  - Đơn giản: 1 ctaLink/row dùng cho FB/IG/Threads/LinkedIn.
  - Nâng cao: map platform→channel (cần cấu trúc phức tạp hơn).
  → Đề xuất: bắt đầu 1 ctaLink/row, mở rộng sau.

## Related files
- MODIFY: `n8n-workflows/mkt-copy-gen.json` — Build Gemini request (chèn ctaLink vào prompt + schema giữ nguyên).
- MODIFY: `leads`... không. MODIFY: `calendar` tab — thêm cột `ctaLink`.
- MODIFY: prompt copyVi/copyEn/copyThreads — CTA dùng ctaLink; copyX giữ "in bio".

## Implementation steps
1. Thêm cột `ctaLink` vào calendar tab.
2. copy-gen Build Gemini request: đọc row.ctaLink → nếu có, chèn instruction "CTA cuối bài dẫn về: {ctaLink}".
3. copyX prompt: GIỮ "link in bio" (không nhận ctaLink) — tránh phí X.
4. Test: row có ctaLink → copy-gen sinh → verify link xuất hiện trong copyVi/copyEn/copyThreads, KHÔNG trong copyX.
5. Fire test 1 nền (vd Threads với t.me link) → verify link click-được trong post thật.

## Todo
- [ ] Cột ctaLink vào calendar
- [ ] copy-gen chèn ctaLink vào CTA (copyVi/copyEn/copyThreads)
- [ ] copyX giữ "link in bio"
- [ ] Test copy-gen output có link đúng
- [ ] Fire test 1 nền verify link sống

## Success criteria
copy-gen sinh CTA chứa ctaLink trong copyVi/copyEn/copyThreads; copyX vẫn "in bio"; post thật có link bấm
được → dẫn tới kênh lead.

## Risks
- X phí link: tuyệt đối KHÔNG nhét URL vào copyX.
- Link xấu/dài làm copy kém: dùng link ngắn (wa.me, t.me vốn ngắn; cal link có thể cần rút gọn).

## Security
- Không có secret. ctaLink là public link.

## Next
Hoàn tất vòng post→lead. Sau đó Khối A (content factory) làm post đẹp hơn.
