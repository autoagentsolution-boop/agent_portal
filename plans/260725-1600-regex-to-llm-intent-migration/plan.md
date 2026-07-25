# Regex → LLM-authoritative intent migration

## Vấn đề (mâu thuẫn kiến trúc, user-confirmed)

Chuỗi bug hôm nay — F19 scope/platform bleed, platform paraphrase drop, false-removal
"publish without review" — **cùng một root cause**: regex đang cố phân loại INTENT trên natural
language. Mỗi lần vá lại đẻ một false-positive khác. Bằng chứng: `parseRemovals` phải thêm cơ chế
"verb-near-target window ±24 chars" — dấu hiệu kinh điển của regex đang làm việc của một semantic
parser. Nó sẽ vỡ tiếp với "don't publish to Facebook but do post to Instagram", phủ định lồng, hay
VN đảo trật tự.

Ưu tiên user: **KHÔNG quan tâm nhanh, quan tâm hiệu quả + chất lượng.** Token cho intent extraction
sẽ rẻ dần (LLM khác rẻ hơn Gemini, hoặc retrain local). Nên chi phí một LLM call < chi phí debug
nhiều vòng regex khi feature rộng ra (VI + EN + 30 ngôn ngữ).

## Ranh giới đúng (nguyên tắc phân loại — GIỮ LÀM LUẬT)

| Loại | Ai xử | Ví dụ | Verdict |
|---|---|---|---|
| **FACT extraction** | regex OK | `@email`, tên platform "Facebook", một mốc thời gian | GIỮ — trích sự thật, không suy luận |
| **INTENT classification** | LLM | removal vs addition? scope single/campaign? "without review" = bỏ publish hay bỏ duyệt? | MIGRATE — cần đọc cả câu, phủ định lồng |

Codebase đã ĐÚNG hướng này ở CONTENT language (`contentLanguageFor` LLM-authoritative) + goal intent
(Track A: scope/autoPublish/quality do model khai qua `requirement-prompt`). Nợ còn lại: **removals +
một phần email routing vẫn regex-as-classifier.**

## Bề mặt migrate THỰC SỰ (đã grep, hẹp hơn tưởng)

Chỉ đường LIVE (Gemini có mặt). `analyzeDeterministic` là no-LLM fallback — ĐÚNG vai, KHÔNG đụng.

| Site | File:line | Loại | Hành động |
|---|---|---|---|
| `parseRemovals(message)` union | `requirement-analyzer.ts:134` | INTENT | ❌ BỎ union — `removalsSchema` đã có trong prompt; model khai. Regex chỉ còn fallback khi model omit removals (giữ nguyên nhánh `: parseRemovals(message)` NHƯNG chỉ chạy khi model không khai gì). |
| `parseRemovals(ctx.message)` union | `atria-tools.ts:343` | INTENT | ❌ BỎ union thứ 2 (chồng lỗi). Removals lấy TỪ analyzer's LLM output, không re-parse raw msg. |
| `parseEmailIntent(ctx.message).isEmail` | `atria-tools.ts:314,467` | INTENT | ⚠️ TÁCH: `isEmail` (INTENT) → brain's `kind` declaration đã có; recipient `@` (FACT) → giữ regex. |
| `parsePlatforms` × 2 | `requirement-analyzer.ts:147`, `atria-tools.ts:372` | FACT | ✅ GIỮ (platform-name extraction + recovery hôm nay) |
| `parseEmailIntent(...).to` (@ address) | như trên | FACT | ✅ GIỮ |

## Prompt work cần thiết (điều kiện tiên quyết trước khi bỏ union)

Model phải khai removals ĐÁNG TIN trước khi ta bỏ regex union. Hiện `requirement-prompt.ts` đã có
`removals: { disableOutputs, dropPlatforms }` — nhưng chưa test kỹ trên câu phủ định lồng. Cần:
- Thêm ví dụ trong prompt cho: phủ định lồng ("don't publish to X but post to Y"), false-removal
  ("publish without review" = KHÔNG removal), VN đảo trật tự.
- Pin live-gemini test: mỗi ca này → model khai removals đúng, KHÔNG cần regex.

## Kế hoạch triển khai (đề xuất phases, chưa chốt)

### Phase 0 — Đo baseline (adversarial corpus) — ✅ DONE
Corpus: `src/orchestration/testing/intent-corpus.ts` (false-removal, nested-negation, true-removal,
scope, fact). Kết quả đo (live Gemini + regex):

| Path | Intent cases | Ghi chú |
|---|---|---|
| **Regex** (deterministic + parseRemovals) | **8/10** | Fail: "no longer just FB" (false drop facebook), "don't FB but IG" (không parse được nested negation) |
| **LLM raw** (model's declared removals, không union) | **10/10** | Model khai đúng cả false-removal LẪN nested negation — bằng chứng để bỏ union |
| **LLM qua analyzer CŨ** (có regex union) | **8/10** | Union regex CORRUPT lại 2 ca model đã đúng → chứng minh union là thủ phạm |

Kết luận: model đọc cả câu tốt hơn regex ở INTENT; union regex là nguồn bug. An toàn để bỏ union.

### Phase 1 — Prompt hardening — ✅ DONE
`requirement-prompt.ts` removals rule bổ sung 4 ví dụ tường minh: "publish without review" (không
removal), "no longer just FB" (additive), "don't FB but IG" (nested → dropPlatforms), "without a doubt"
(idiom). Model giờ khai đúng cả 10/10 corpus.

### Phase 2 — Bỏ regex union — ✅ DONE
- `requirement-analyzer.ts`: removals LLM-authoritative (`rawRemovals != null && valid` → model wins;
  `parseRemovals` chỉ chạy khi model omit field). Platform union trừ đi model's `dropPlatforms` (không
  kéo lại platform model cố ý loại).
- `atria-tools.ts`: bỏ `parseRemovals(ctx.message)` union hoàn toàn. Thay bằng: khi brain paraphrase
  (goal_description ≠ raw) VÀ removals rỗng → re-analyze RAW message qua LLM, lấy tín hiệu non-empty. No
  regex. Platform recovery giữ nhưng trừ model's dropPlatforms.
- `intent-corpus.ts` + verify-master live block: pin 12 ca (10 intent + 2 fact) → all green.
- Multi-turn paraphrase-drop removal: verified (paraphrase rỗng → raw-msg LLM re-analyze → video dropped).

### Phase 3 — Tách parseEmailIntent — ✅ DONE (kết luận: no-op có chủ đích)
Đã đánh giá đầy đủ. `parseEmailIntent(ctx.message)` còn ở 2 chỗ: (1) task-email recipient composition
(line ~314) — dùng `.to` (@ address = FACT, giữ) + `.isEmail` như 1 trong 4 fallback signal; (2)
`rescueScheduleProposal` (line ~473) — `.isEmail` quyết kind khi brain KHÔNG propose (đã là sanctioned
regex fallback, đúng vai). Kết luận: `.isEmail` ở (1) chỉ là fallback CUỐI sau lead/declaredTo/requestAddr;
ở (2) là rescue-only. CẢ HAI đã là fallback, KHÔNG phải classifier trên happy path (brain's `kind` owns
it). **KHÔNG cần migrate — đây đã đúng ranh giới FACT/INTENT.** Phase đóng, không có code change.

### Phase 4 (tùy chọn) — Adversarial verifier — ⏸ NOT STARTED (chờ user chốt cost + scope)
KHÔNG bắt đầu — cố ý. Corpus hiện (12 ca) đã đủ cho regression + đã pin live. Một proposer→verifier loop
để tự mở rộng corpus chỉ đáng làm khi feature rộng ra (nhiều ngôn ngữ hơn). Token cost + phạm vi user
CHỐT trước khi chạy — không tự làm.

## Rủi ro
- **Removals qua model kém tin hơn regex trên câu ĐƠN GIẢN** ("bỏ video") — regex bắt chắc, model có
  thể miss. Vì vậy Phase 0 corpus phải gồm cả ca đơn giản; nếu model miss, GIỮ regex fallback (không
  bỏ hẳn, chỉ bỏ UNION — ưu tiên LLM, fallback regex khi model rỗng).
- **Regression surface cao**: removals đụng mọi refine turn. Mỗi phase phải re-test đường refine
  (add-then-remove, remove-then-confirm).
- **Chi phí token multi-turn**: user chấp nhận (sẽ rẻ dần). Nhưng đo thực tế ở Phase 0 để có số.

## Success
- Corpus adversarial: LLM-authoritative path ≥ regex path trên mọi ca INTENT, và KHÔNG thua trên ca
  FACT (platform/email — vẫn union regex).
- Bỏ được 2 `parseRemovals` union + `parseEmailIntent.isEmail` khỏi đường LIVE.
- verify-master + live re-test (GreenLeaf false-removal, F19, multi-platform) xanh.
- Regex còn lại CHỈ ở: fact-extraction (platform/@) + no-LLM `analyzeDeterministic` fallback.

## KHÔNG làm (YAGNI / scope)
- KHÔNG đụng `analyzeDeterministic` (no-LLM fallback đúng vai).
- KHÔNG bỏ `parsePlatforms` / @-recipient (FACT, giữ).
- KHÔNG tự chạy Phase 4 adversarial verifier — user chốt cost trước.
- KHÔNG migrate content-language (đã LLM-authoritative rồi).

## Liên quan
- Bug đã fix hôm nay (tiền đề): `ec312b1` (paraphrase+false-removal), `b4b8bbd` (F19), `57deb67`
  (reply-language). Đây là track SAU CÙNG đóng nốt nợ regex-as-classifier.
- Feedback: `[[feedback_localize_user_facing_not_model_input]]` (recurrence #8 — mechanism-in-a-verify).
