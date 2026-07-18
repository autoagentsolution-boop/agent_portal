# P5 — Design consistency (whole-app dark neural) + Atria "alive"

Branch `pivot/video-content-farm` · 2026-07-10 · continues the demo big-plan (P5, the last item).
DC2 **DECIDED with user: whole-app dark neural skin** — extend the `--cc-*` violet/space aesthetic
(`#0a0b1e` bg, violet `#9d7bff`) to the ENTIRE app; remove light mode. One cohesive "AI command
center" identity.

## Current state (audited)
Three overlapping theme systems in `web/src/styles.css` (1145 lines, 24 CSS vars):
1. `:root` — base dark `#0f1115` / green `#10a37f`
2. `.app-root` — **light default** `#ffffff` + `.app-root.theme-dark` toggle (`#212121` ChatGPT-style)
3. `.cc-*` / `--cc-*` — Command Center neural violet/space (`#0a0b1e`), always dark
Toggle app→light and the CC stays dark-violet = the clash. Theme state = `App.tsx` `useState<Theme>('light')`
+ top-nav toggle. 46 components, all CSS-var-driven → changing token VALUES cascades.

## Status (2026-07-10) — 3 P5 commits, NOT pushed
- P5.1 audit ✅ (`reports/design-system-spec-260710.md`)
- P5.2 token migration ✅ committed + browser-verified (Impact was white→neural, CC intact)
- P5.4 chunk 1 living core ✅ committed (emanating rings + HUD reticles + breathing orb, reactive is-conducting)
- P5.4 chunk 2 data-flow dots ✅ committed + browser-verified — CC: violet dot Atria→agent (dispatch,
  ambient idle) + agent-colour dot back on real SSE run (ack); DAG: connector spine + status markers +
  glowing dot flows into running step. User-locked: 2-colour dots, ambient+real-burst, both CC+DAG.
- P5.3 per-page polish ✅ committed+pushed — centered `.master-home` pages, "Estimated estimate"→"derived",
  keyset "Load more" pagination for leads + post board.
- P5.4 chunk 3 voice-amplitude sync ✅ committed+pushed — `voice-viz.ts` Web Audio analyser → `--voice-level`
  → core glow/orb ride TTS narration. Browser-verified (level tracks waveform 0.016→1.0).
- **P5 COMPLETE — all phases done + pushed thru `988f281`.**

## Phases
- **P5.1 DC1 — Design-system spec** (ui-ux-designer): audit the 3 systems → ONE unified dark-neural
  token set (bg/panel/border/text/muted/accent + violet family, spacing, type scale, radius, states);
  map which `--cc-*`/`.app-root` rules fold into shared tokens; AI-slop kill-list. Output = report, no code.
  Status: IN PROGRESS.
- **P5.2 DC2 — Token migration** (implement): redefine shared tokens (`--bg`/`--panel`/`--text`/`--accent`…)
  to neural values at `:root`; DELETE light + `.theme-dark` blocks; fold `--cc-*` into shared tokens;
  remove theme toggle in `App.tsx`/top-nav (lock dark). Verify: web build + browser screenshot per surface.
- **P5.3 DC1 — Per-page polish** (fullstack, chunked): each page/surface (CC, chat, post-workflow, impact,
  leads, email, instructions, board) restyled to the system + senior design-review pass; each chunk
  shipped + browser-verified separately.
- **P5.4 DC3 — Atria "alive" amplification** — VISION (user 2026-07-10): make Atria feel like a TRULY
  LIVING entity, not a static graph. Reference aesthetic = **JARVIS / Iron-Man holographic AI** — a modern
  ELECTRONIC PULSE, sleek and reactive. Concrete goals:
  - Core = a breathing electronic pulse (not a plain glow): layered concentric rings/waveform, subtle
    energy ripple, HUD-like reticle feel. Continuous "alive" idle heartbeat.
  - Reactive core states: idle (slow breathe) → thinking (faster, tighter pulse + particle activity) →
    speaking (waveform reacts). State-driven, visibly different.
  - Node choreography: sequenced activation as a plan runs (energy travels edge→node), reactive
    edge-energy (flowing pulses along active edges), not binary on/off.
  - **Voice-reactive (later):** sync the core pulse/waveform to the Gemini-TTS narration amplitude so Atria
    visibly "speaks" — the pulse rides the voice. Wire to the existing `/voice/tts` read-aloud seam.
  - Identity: cohesive, premium, "feels alive and adapts" — the demo WOW moment.
  Build order: static neural skin + core-pulse redesign first; then run-driven choreography; then
  voice-amplitude sync last (needs the TTS audio stream exposed to the core component).

## Verification
Browser-drive via agent-browser (session for owner `6455c2bd`, cookie recipe in
[[project_demo_bigplan_260710]]). Screenshot each surface light-vs-before. `npm run build` green per chunk.

## Recommended order
P5.1 (audit) → P5.2 (token migration, highest leverage — one edit recolors everything) → P5.3 (per-page
polish) → P5.4 (alive). Ship + verify each.
