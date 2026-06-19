# Cost Comparison — Bún Mắm Veo vs Kling (CORRECTED)

**Date:** 2026-06-17
**Fixture:** `FoodImage/BunMam/bun-mam-storyboard-v2.json` — 12 panels, 56s total
**Pricing source:** Veo từ Google AI Studio pricing page (verified 2026-06-17); Kling từ fal.ai model docs (Replicate pricing tương đương ±5%)

> **Correction notice:** Báo cáo trước ước $0.05/clip cho Veo dựa trên constant `VEO_LITE_COST` trong pipeline. Sai. Google bill Veo **per-second of output video**, không per-call. Cost thực cao hơn 6-8× tuỳ panel duration.

## TL;DR

| Backend | Per-sec | Bún Mắm 56s | 8 videos/tháng |
|---|---|---|---|
| **Veo 3.1 Lite 720p** | $0.05/sec | **$2.80** | $22.40 |
| Veo 3.1 Lite 1080p | $0.08/sec | $4.48 | $35.84 |
| **Veo 3.1 Fast 720p** | $0.10/sec | $5.60 | $44.80 |
| Veo 3.1 Fast 1080p | $0.12/sec | $6.72 | $53.76 |
| **Kling 2.1 Standard** (re-author) | ~$0.05/sec | **$3.00** | $24.00 |
| **Kling 2.1 Pro** (re-author) | ~$0.09/sec | $5.40 | $43.20 |

→ Veo Lite 720p và Kling Standard gần **bằng nhau** ($2.80 vs $3.00). Pipeline cũ báo $0.66 = sai 4-5×.

## Cách 2 platform tính tiền (clarify)

### Veo 3.1 — per-second of output

Per Google AI Studio pricing page:

| Model | 720p | 1080p | 4K |
|---|---|---|---|
| Veo 3.1 Lite | $0.05/sec | $0.08/sec | ❌ N/A |
| Veo 3.1 Fast | $0.10/sec | $0.12/sec | $0.30/sec |
| Veo 3.1 Standard | $0.40/sec | $0.40/sec | $0.60/sec |

- **Free tier: KHÔNG có** — Veo 3.1 chỉ available trên paid tier (Tier 1+)
- Tính theo seconds of generated video, không phải per API call
- Pipeline constant `VEO_LITE_COST = 0.05` đang tính per-clip = sai, thực = `duration × $0.05`

### Kling 2.1 — per-generation (= unit) trên Replicate/fal.ai

Kling không bán per-second cho khách. Mỗi generation = 1 fixed unit dù 5s hay 10s:

| Mode | 5s clip | 10s clip | $/sec equiv |
|---|---|---|---|
| Kling 2.1 Standard | $0.25 | $0.50 | $0.05/sec |
| Kling 2.1 Pro | $0.45-0.49 | $0.90 | $0.09/sec |

- **Free tier: KHÔNG có** trên Replicate/fal.ai — pay-per-use ngay từ first call
- Mỗi prediction = 1 unit charge cố định theo duration tier
- Snap rule: 1-5s → 5s clip price; 6-10s → 10s clip price (không có giá lẻ)

→ User thấy "tính tiền theo unit" = Kling bán theo **clip** (1 generation), trong khi Veo bán theo **giây**. Cùng $0.05/sec equiv ở standard mode.

### Replicate vs fal.ai vs Direct Kling

| Platform | Kling 2.1 Std 5s | Margin |
|---|---|---|
| Kling official (klingai.com) | ~$0.21 | 0% baseline |
| Replicate | ~$0.25 | +18% |
| fal.ai | $0.25-0.28 | +18-33% |

Replicate ≈ fal.ai. Direct Kling tiết kiệm ~15% nhưng cần signup partner.

## Bún Mắm fixture breakdown

```
panels:    12  (1 intro + 10 step + 1 outro)
durations: 6, 4, 4, 6, 6, 4, 4, 4, 4, 4, 4, 6  =  56 seconds
TTS:       12 narrations (Vietnamese, ~5-7s spoken each)
Images:    12 panels pre-gen bằng ChatGPT, đã save vào FoodImage/BunMam/
```

## Veo 3.1 path — chính xác

### Tier 720p Lite (cheapest Veo path)

| Stage | Unit cost | Tính toán | Subtotal |
|---|---|---|---|
| ChatGPT (storyboard + image gen) | Plus $20/mo flat | — | $0 marginal |
| Adapter — TTS Azure Edge | free | 12 × 0 | $0 (pipeline báo $0.06 = bookkeeping buffer) |
| Veo Lite 720p | $0.05/sec | 56s × $0.05 | **$2.80** |
| Music (local) | $0 | — | $0 |
| Remotion (local CPU) | $0 | — | $0 |
| **TOTAL** | | | **$2.80** |

### Khi Lite quota cạn → fallback Fast

| Stage | Unit cost | Tính toán | Subtotal |
|---|---|---|---|
| Veo Fast 720p | $0.10/sec | 56s × $0.10 | **$5.60** |
| TOTAL | | | **$5.66** |

Hôm nay team account hit 429 ở panel 7 sau khi đã render panel 1-6 → tổng burn (giả định Lite all): 6 × ~4.67s × $0.05 ≈ **$1.40** (chứ không phải $0.30 như báo cáo cũ).

## Kling 2.1 path — chính xác

### Vấn đề snap duration

Kling chỉ accept `duration ∈ {5, 10}`. Fixture Bún Mắm hiện tại {4, 6}:
- 4s panel → 5s clip (8 panels, +1s mỗi cái)
- 6s panel → 10s clip (4 panels, +4s mỗi cái)
- Total snap: 8×5 + 4×10 = **80s** → vượt Shorts cap 60s ❌

→ Phải re-author fixture cho Kling.

### Re-authored cho Kling (11 panels = 60s = cap)

```
1 intro 5s + 9 step 5s + 1 outro 10s = 60s
```

#### Kling Standard

| Stage | Unit cost | Qty | Subtotal |
|---|---|---|---|
| TTS Edge | $0 | 11 | $0 |
| Kling Std 5s clip | $0.25 | 10 | $2.50 |
| Kling Std 10s clip | $0.50 | 1 | $0.50 |
| **TOTAL** | | | **$3.00** |

#### Kling Pro

| Stage | Unit cost | Qty | Subtotal |
|---|---|---|---|
| TTS Edge | $0 | 11 | $0 |
| Kling Pro 5s clip | $0.45 | 10 | $4.50 |
| Kling Pro 10s clip | $0.90 | 1 | $0.90 |
| **TOTAL** | | | **$5.40** |

### Scenario lười (chạy as-is, không re-author)

Pipeline gen 12 clips theo snap → cost $1.66 nhưng Remotion sẽ cắt clip về JSON's panel.durationSec → lãng phí ~$0.80 phần clip không xài. Thực dùng ~$0.86 nhưng vẫn pay $1.66. Không khuyến khích.

## Veo vs Kling — same per-sec equivalent

| Backend tier | $/sec equiv |
|---|---|
| Veo 3.1 Lite 720p | $0.05/sec |
| **Kling 2.1 Standard** | **$0.05/sec** ← bằng Veo Lite |
| Veo 3.1 Lite 1080p | $0.08/sec |
| Kling 2.1 Pro | $0.09/sec |
| Veo 3.1 Fast 720p | $0.10/sec |
| Veo 3.1 Fast 1080p | $0.12/sec |
| Veo 3.1 Standard | $0.40/sec |

→ **Standard tier ngang giá** giữa Veo Lite 720p và Kling Std. Chênh lệch giá thật chỉ vì pipeline snap duration khác nhau (Veo {4,6,8} cho Bún Mắm 56s, Kling {5,10} cần re-author 60s).

## Monthly projection — 2 videos/tuần = 8/tháng

| Backend | Per video | 8 vid | Annual |
|---|---|---|---|
| Veo Lite 720p | $2.80 | $22.40 | $268.80 |
| Veo Lite 1080p | $4.48 | $35.84 | $430.08 |
| Veo Fast 720p | $5.60 | $44.80 | $537.60 |
| Kling Standard | $3.00 | $24.00 | $288.00 |
| Kling Pro | $5.40 | $43.20 | $518.40 |

Plus fixed: ChatGPT Plus $20/mo.

## Tại sao báo cáo cũ sai

Code constant `render-service/src/jobs/gen-explode-motion.ts:VEO_LITE_COST = 0.05` được dùng như giá per-clip, nhưng thực Google bill per-second. Pipeline log "freshCostUsd: 0.05" cho mỗi clip → underestimate 4-8×.

Cần fix:
```js
// SAI:
const VEO_LITE_COST = 0.05;  // assumed per-clip
const freshCostUsd = cacheResult.cached ? 0 : VEO_LITE_COST;

// ĐÚNG:
const VEO_LITE_USD_PER_SEC = 0.05;
const freshCostUsd = cacheResult.cached ? 0 : (durationSec * VEO_LITE_USD_PER_SEC);
```

Tương tự `video-backends.ts:costPerClipUsd` cho Veo backend đang cố định 0.05 → cần đổi sang per-sec hoặc tính `duration × rate` tại từng clip.

## Verdict

| Bạn ưu tiên gì | Backend |
|---|---|
| Rẻ nhất + chấp nhận 720p | **Veo Lite 720p** ($2.80) — nếu team quota fix được |
| Rẻ nhất + không lo quota | **Kling Standard** ($3.00) — chỉ đắt hơn $0.20/video |
| Quality cao nhất từ i2v | Kling Pro hoặc Veo Fast 1080p (~$5.40-6.72) |
| Cinematic Hollywood | Veo 3.1 Standard ($22.40) — không cần thiết cho Shorts |

→ **Khuyến nghị: Kling Standard.** Cost gần bằng Veo Lite, quota unlimited, không bị 429 ngày sản xuất.

## Unresolved questions

- Pipeline cost accounting cần fix: đổi `costPerClipUsd` thành `costPerSecondUsd` cho cả Veo + Kling, tính bookkeeping đúng
- Replicate exact pricing cần bạn verify khi sign-up — research $0.25/5s std có thể drift ±10%
- Có cần test 1 Kling clip trước khi switch toàn bộ để check motion quality cho food i2v?
- ChatGPT prompt v4 đang ép `durationSec ∈ {4,6,8}` (Veo) — khi switch Kling cần version `{5,10}` riêng. Có nên tham số hoá prompt theo `VIDEO_PROVIDER` không?
- TTS pipeline báo $0.06 dù dùng Edge free — chưa giải thích được source của số này, có thể bookkeeping nhầm Google Neural2 tier
