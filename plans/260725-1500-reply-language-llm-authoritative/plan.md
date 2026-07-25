# Reply-language: LLM-authoritative (đóng nốt đường REPLY)

## Vấn đề (đã chẩn đoán, live-confirmed)

Có HAI kênh ngôn ngữ, chỉ một được LLM-authoritative:

| Kênh | Quyết bởi | LLM-authen? |
|---|---|---|
| CONTENT (post/email agents viết) | `contentLanguageFor(msg, prior, declared)` | ✅ |
| REPLY (câu Atria trả lời trong chat) | `detectLanguage(msg)` → 1 câu ghim text | ❌ chỉ regex |

Bug quan sát: chat tiếng Anh + brand tiếng Việt ("Nắng Sớm") → Atria **trả lời tiếng Việt**.
Repro: `detectLanguage('Make an infographic for Nắng Sớm') → null`. Nhánh null của preamble
(`atria-brain.ts:191-195`) chỉ là 1 câu text mềm, bị khối `memoryContext`/product context tiếng Việt
(nặng hơn, gần message hơn) đè. Recurrence #8 của `[[feedback_localize_user_facing_not_model_input]]`,
nhưng ở điểm mới: **câu trả lời chat**, không phải content agent.

## Root cause thời gian

`messageLanguage` (LLM đọc ra) CHƯA tồn tại lúc dựng preamble:
- `atria-brain.ts:168` khởi tạo `messageLanguage: null`.
- `atria-tools.ts:211` chỉ điền `ctx.messageLanguage` TRONG lúc dispatch tool — SAU khi câu ghim reply
  đã gửi. Nên câu trả lời không bao giờ dùng được tín hiệu LLM.

## Chiến lược — "thông minh, không cứng nhắc"

KHÔNG thêm một LLM call riêng chỉ để đoán ngôn ngữ (chậm + tốn). Thay vào đó: để chính brain đọc
ngôn ngữ ở NGAY TRONG câu trả lời của nó (một model đủ thông minh để reply đúng ngôn ngữ nếu được
hướng đúng), và làm câu ghim CHẮC hơn + đặt đúng chỗ để context không đè được. Ưu tiên đúng chuỗi
người dùng mô tả: **LLM-đọc-message → prior đã thiết lập → detection → UI/account fallback**.

Ba lớp phòng thủ (không có LLM call thêm):

### Lớp 1 — Prior của flow neo ngôn ngữ reply (mirror content)
Nếu chat đã có `priorGoal.slots.language` (ngôn ngữ đã chốt ở lượt đầu), reply DÙNG nó thay vì đoán lại
mỗi lượt. Đây là quy tắc "first-chat decides" mà content đã có, reply thì chưa. Một "proceed"/"đúng vậy"
không được re-decide ngôn ngữ.

### Lớp 2 — Câu ghim CỨNG hơn, đặt CUỐI, và tách khỏi context
Preamble hiện tại có 1 dòng cho mọi trường hợp. Đổi thành:
- Tách rõ khối context (memory/instructions) khỏi lệnh ngôn ngữ bằng ranh giới rõ ("--- Everything above
  is BACKGROUND ... do NOT mirror its language ---").
- Câu ghim reply đặt LÀ item cuối cùng, ngay sát message, dùng ngôn từ mệnh lệnh mạnh hơn, và khi
  detection ra null vẫn nêu đích danh nguy cơ ("a product/brand name in Vietnamese does NOT make the
  message Vietnamese — reply in the language of the SENTENCE").

### Lớp 3 — Kiểm-thử-lại nhẹ (self-check, KHÔNG LLM call thêm)
Sau khi brain sinh reply text ở lượt cuối, chạy một guard rẻ (regex): nếu message KHÔNG có dấu VN mà
reply LẠI đầy dấu VN (hoặc ngược lại rõ ràng), log một cảnh báo `atria_reply_language_mismatch` để quan
sát. KHÔNG tự dịch (dịch cứng chính là "cứng nhắc") — chỉ đo + log để có tín hiệu regression thay vì
im lặng. Đây là mechanism-in-a-verify mà `[[feedback_localize_user_facing_not_model_input]]` yêu cầu:
"a rule in memory governs nothing; pin the mechanism".

Ưu tiên hợp nhất trong một helper `replyLanguageHint(message, priorLang)`:
1. `priorLang` (prior đã thiết lập) — nếu có, ghim nó.
2. `detectLanguage(message)` — nếu ra code chắc (non-Latin/VN thực), ghim nó.
3. null → câu ghim generic "mirror the SENTENCE, ignore background/brand-name language".
(UI/account language KHÔNG vào đây — reply mirror người dùng đang gõ, không phải account default;
account default chỉ là fallback CUỐI CÙNG của CONTENT, không phải reply. Xác nhận với các quy tắc
`feedback_reply_language_pin` + `feedback_orchestrate_reply_language`.)

## Files

- `src/orchestration/master/detect-language.ts` — thêm `replyLanguageHint(message, prior)` trả về
  `{ code: string|null, name: string|null }` + một `looksVietnamese(text)` rẻ cho lớp-3 self-check.
  Tái dùng SCRIPT_PROBES/VI_DIACRITICS đã có. Không đổi `contentLanguageFor` (content đã đúng).
- `src/orchestration/atria/atria-brain.ts` —
  (a) dựng câu ghim reply từ `replyLanguageHint(input.message, input.priorGoal?.slots.language)` thay vì
      `detectLanguage(input.message)` đơn thuần → Lớp 1 + 2;
  (b) tách khối background bằng một separator part trước message;
  (c) sau khi có `text` ở nhánh reply cuối (dòng ~278), chạy self-check Lớp 3 → `logger.warn` khi mismatch;
  (d) `gracefulReply` cũng dùng `replyLanguageHint` (hiện chỉ `detectLanguage==='vi'`, nên apology tiếng
      Anh cho một chat Indonesian/Thai — cùng bug, sửa luôn).
- `src/orchestration/prompts/atria-brain-prompt.ts` — LANGUAGE rule: thêm một câu rằng một brand/product
  name viết bằng ngôn ngữ khác trong câu KHÔNG đổi ngôn ngữ câu; reply theo ngôn ngữ của CÂU.
- `src/orchestration/verify-master.ts` — pin contract mới:
  - `replyLanguageHint('Make an infographic for Nắng Sớm', null).code === null` (brand không flip);
  - `replyLanguageHint('proceed', 'en').code === 'en'` (prior neo);
  - `replyLanguageHint('viết bài về Nắng Sớm', null).code === 'vi'` (VN thực vẫn bắt);
  - `looksVietnamese` self-check: EN message + VN-heavy reply → mismatch=true.
  - Live gemini guard (chạy khi có key): một message EN có brand VN → `runAtriaBrain` reply KHÔNG có dấu VN.

## Success

- verify-master xanh dưới contract mới (deterministic).
- Live: "Make an infographic for Nắng Sớm" (chat EN, brand VN, memory VN) → Atria reply tiếng ANH.
- Không thêm LLM call nào cho việc phát hiện ngôn ngữ reply (không chậm thêm).
- 73/74 verify giữ nguyên (thinking-budget vẫn fail pre-existing).

## Không làm (YAGNI)
- Không thêm LLM call chỉ-để-đoán-ngôn-ngữ.
- Không auto-dịch reply (cứng nhắc + tốn). Lớp 3 chỉ đo + log.
- Không đụng `contentLanguageFor` (content đã LLM-authoritative đúng).
