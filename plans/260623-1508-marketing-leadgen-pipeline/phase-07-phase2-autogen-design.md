# Phase 07 — Phase 2 Auto-Gen Migration (DESIGN ONLY)

**Context:** [plan.md](plan.md) · NOT coded now. Reuses `scripts/gen-cooking-images.ts` (Nano Banana engine).
**Priority:** P3 (after Phase 1 proven). **Status:** design-level only.

## Goal
Replace manual ChatGPT creative with machine generation + a human review gate. The Sheet shifts from
**asset-store** (P01) to **brief** (Sales fills intent; machine produces the deck).

## Why Phase 1 is manual first (capture this rationale)
Phase 1's manual ChatGPT step is a **golden-prompt harvesting phase**. Every post the user crafts by hand
validates a copy style + slide-layout + image-style that WORKS. Those validated prompts/styles become the
TEMPLATES Gemini uses in Phase 2. Automating before we know what converts = automating guesses. We build the
prompt library first, then mechanize it. (Mirrors video-farm's "golden prompt collection" approach in memory.)

## Sheet schema shift (calendar tab → brief mode)
| Phase 1 (asset-store) | Phase 2 (brief) |
|-----------------------|-----------------|
| copyVi/copyEn filled by human | `valueProps` (bullets) filled by Sales; copy GENERATED |
| driveFolderId points to uploaded assets | driveFolderId WRITTEN BACK by gen loop |
| status: ready→posting→posted | adds: `brief → generating → review → approved → ready → …` |
- New input cols: `valueProps` (csv/bullets), `tone`, `slideCount`. Keep `product`,`angle`,`platforms`,`scheduledAt`.

## Gen loop (new workflow, runs BEFORE post loop)
```
[1] Cron / manual trigger
       ↓
[2] Sheets: pick rows status=="brief"
       ↓
[3] Gemini text: product+angle+valueProps → JSON { copyVi, copyEn, slideOutline[] }
       (golden-prompt templates from Phase 1 as system prompt)
       ↓
[4] Nano Banana images: reuse scripts/gen-cooking-images.ts ENGINE (gemini-2.5-flash-image,
       endpoint generativelanguage…:generateContent, base64 inlineData → PNG) — one hero + per-slide bg
       ↓
[5] Google Slides API: build deck from slideOutline → export each slide as PNG
       ↓
[6] Drive: upload hero + slides/*.png to marketing-creative/<id>/ ; write driveFolderId + copy back to sheet
       ↓
[7] Sheets: status="review"
```

## REVIEW GATE (mandatory — never auto-post machine creative)
```
status=review  →  human opens Drive deck + reviews copy  →  sets status="approved"
                                                          (or "brief" to regenerate)
approved  →  a tiny promote step sets status="ready"  →  Loop A (Phase 1 post workflow, UNCHANGED) posts it
```
- Loop A from Phase 1 is reused verbatim — it only ever acts on `ready`. The gate sits entirely upstream.
- Hard rule: NO path from `generating` directly to `ready` without passing human `approved`.

## Reuse map
| Phase 2 need | Reuse from |
|--------------|-----------|
| image gen engine | `scripts/gen-cooking-images.ts` (Nano Banana call, idempotent skip-if-exists, batch=4) |
| Gemini key | `GEMINI_API_KEY` / `NANO_BANANA_API_KEY` (`.env.example:17,21`) |
| post loop | Phase 1 `mkt-post-scheduler.json` UNCHANGED |
| Drive/Sheets creds | same as Phase 1 |
| golden prompts | harvested from Phase-1 manual ChatGPT history |

## New components to design later
- Google Slides API enablement + OAuth scope (`presentations`, `drive.file`).
- Gemini structured-output prompt → strict slideOutline JSON schema.
- Slides→PNG export (Slides API `thumbnail` or export-to-Drive-then-render).
- Cost model: Gemini text + N×Nano Banana ($0.039/img scouted `gen-cooking-images.ts:191`) + Slides (free).

## Risk Assessment (design-level)
| Risk | L×I | Mitigation |
|------|-----|------------|
| Auto-posted bad creative | M×H | hard review gate; no auto-promote |
| Gemini slideOutline schema drift | M×M | strict JSON schema + validation node, regenerate on parse fail |
| Slides API export fidelity | M×M | prototype export before committing; fall back to Nano Banana full-slide images |
| Cost creep from regen loops | M×M | reuse idempotent skip-if-exists; cap regenerations per row |

## Success Criteria (when Phase 2 is eventually built)
- [ ] Sales fills brief → machine produces deck in Drive → status=review.
- [ ] No row reaches `ready` without human `approved`.
- [ ] Approved row posts via UNCHANGED Phase-1 Loop A.
- [ ] Golden-prompt templates from Phase 1 drive gen quality.

## Next Steps
Do NOT start until Phase 1 has run long enough to harvest a validated prompt library + prove FB/Threads ROI.
