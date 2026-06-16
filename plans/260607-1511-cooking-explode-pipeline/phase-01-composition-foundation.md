# Phase 01 — Composition Foundation (DONE)

**Status**: ✅ Completed 2026-06-07
**Effort**: 1 day (R&D + pivot + working pipeline)

## Outcome
Working `fixture JSON → validate → assemble prompt → Pro Banana` pipeline. Produces production-grade exploded-view hero composition with Vietnamese text labels baked in. Cross-dish verified (phở bò + bún chả).

## What was built

### Scripts (reusable)
- `scripts/build-explode-composition.ts` — main pipeline entry. Takes `<fixture.json>`, validates, assembles prompt from user template, calls Nano Banana Pro với `screenshot/foodexplode2.png` reference, saves PNG.
- `scripts/quality-test-d.ts` — D quality benchmark (Pro Banana vs base + Veo 3.0 fast)
- `scripts/veo-iterate-explode.ts` — explode aesthetic iteration variants
- `scripts/veo-vortex-test.ts` — vortex motion + camera transition test
- `scripts/veo-i2v-tilt-test.ts` — i2v conditioning verification
- `scripts/build-e2e-prototype.ts` — chained-Veo prototype (DEPRECATED, kept for reference)
- `scripts/build-e2e-continue.ts` — fallback Veo 3.0 fast continuation (DEPRECATED)
- `scripts/e2e-final-stitch.ts` — ffmpeg stitch (DEPRECATED architecture, ffmpeg pattern reusable)
- `scripts/test-spiral-composition.ts` — initial spiral-composition pivot test
- `scripts/veo-explode-test.ts` — 3-variant explode aesthetic gen

### Fixtures (dish input)
- `render-service/fixtures/dishes/pho-bo.json` — 23 ingredients
- `render-service/fixtures/dishes/bun-cha.json` — 19 ingredients (stress test)

### Assets generated
- `out/quality-test-d/spiral-v2/pho-bo-composition.png` — **production-ready hero** (clean, 0 errors)
- `out/quality-test-d/spiral-v2/bun-cha-composition.png` — composition works, 2 minor text errors (1 dup + 1 halluc)
- `out/quality-test-d/*` — all D-test artifacts (sunk R&D)

## Pipeline contract (carry forward)

### Input schema (per dish)
```json
{
  "dish_name": "Phở bò",
  "dish_name_display": "PHỞ BÒ",
  "tagline": "TINH HOA ẨM THỰC VIỆT",
  "serving_vessel_style": "...",
  "table_material": "...",
  "background_style": "...",
  "core_visual_flow": "...",
  "final_dish_description": "...",
  "finish_step": { "label": "HOÀN THIỆN", "prep": "...", "qty": "..." },
  "ingredients": [
    { "id": "muoi", "label": "MUỐI", "prep": "Nêm vừa", "qty": "1/2 thìa cà phê",
      "visual": "...", "group": "seasoning", "order": 1 },
    ...
  ]
}
```

### Validation rules (programmatic in `build-explode-composition.ts`)
1. Every ingredient has: `id`, `label`, `prep`, `qty`, `visual`, `order`
2. No duplicate `id`
3. No duplicate `label`
4. `order` is sequential 1..N (no gaps)

### Prompt template (user-provided, embedded in builder)
- Anchored by user's structured prompt with 10 strict composition rules
- `INGREDIENT_LABELS_BLOCK` assembled from sorted-by-order ingredient list
- Finish step appended at top of label list
- Style direction: photorealistic, cinematic, dark moody, warm tungsten, premium ad poster

### Pro Banana call shape
```
model: nano-banana-pro-preview
endpoint: generateContent
parts: [
  { inlineData: { mimeType: 'image/png', data: <base64 of foodexplode2.png> } },
  { text: <assembled prompt> }
]
generationConfig: { responseModalities: ['IMAGE'] }
```

## Key insights (informs phase 02)
1. **Order matters** — ingredients arranged bottom (invisible cooked-in: broth/seasoning/spice) → top (visible garnish on finished dish). User's rule: "thịt bò và rau thơm là trên cùng [vì] trong tô phở thịt bò và rau thơm là trên cùng. Còn những nguyên liệu không thấy đc như gia vị nêm, nước mắm hay xương bò để hầm thì ở dưới."
2. **`visual` field is critical** — tells Pro Banana exactly what shape/form to render
3. **Reference image conditioning works** — passing foodexplode2.png as inline reference locks aesthetic style → reproducible cross-dish
4. **Density ceiling ~20 ingredients** — beyond that, model starts duplicating/hallucinating labels. Bún chả (19) hit it; pho bò (23 but grouped naturally) didn't.
5. **Vision-verify is required for production** — Phase 02 must add Gemini Flash vision check loop

## Tests run
- pho-bò composition: ✅ 23 labels, all correct, no duplicates, all Vietnamese diacritics rendered
- bún-chả composition: ⚠️ 19 labels, 1 duplicate ("MẬT ONG" x2), 1 hallucinated ("CẮT GẾN"), order minor swap on right side

## Cost spend (sunk)
- D quality test phase total: ~$2.70
- Successful composition gens: $0.10 (pho-bò + bún-chả, 1 try each)

## Not built today (defer to phase 02)
- Vision-verify retry loop
- Veo i2v motion (quota cap hit, retry tomorrow)
- TTS narration script generator
- Suno music integration
- ffmpeg final encode pipeline
- n8n workflow
- Postgres run_log integration
