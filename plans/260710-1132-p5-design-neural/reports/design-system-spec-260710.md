# Unified Neural Design System — Spec + Migration Map

**Date:** 2026-07-10
**Decision (fixed):** entire web app adopts ONE dark "neural" skin (deep violet/space), derived from the Command Center `--cc-*` palette. Light mode removed.
**Source of truth:** `web/src/styles.css` (1146 lines), theme state in `web/src/App.tsx`.
**Scope of this doc:** define the single token set + migration map. No code changed.

Key structural fact that makes this cheap: **the 46 components almost never inline colors — they consume classes in `styles.css` which reference `var(--bg/--panel/--text/--accent/…)`.** Grep confirms only ~26 hardcoded hex across 6 component files (all status colors), and only 3 inline `var(--…)` reads (LeadsPage). So **redefining the `:root` block recolors the whole app automatically.** The work is: (1) rewrite `:root`, (2) delete two light theme blocks, (3) fix ~5 hardcoded status hexes + a handful of light-assuming fallbacks/shadows.

---

## 1. Unified Token Set — the single `:root` to ship

Replace the current `:root` (lines 1–20) with this. Every value is derived from the neural palette so it recolors all class-based components in one edit.

```css
:root {
  /* ── Elevation / surfaces (darkest → raised) ─────────────────── */
  --bg:            #0a0b1e;   /* was #0f1115  — page base (cc-bg) */
  --bg-gradient:   radial-gradient(ellipse at 50% 30%, #16183a 0%, #0a0b1e 60%);
  --panel:         #14162e;   /* was #181b22  — solid card (solidified cc-bg2/panel) */
  --panel2:        #1b1e3d;   /* was #1f232c  — raised / hover / inset */
  --panel-glass:   rgba(20,22,48,0.6); /* cc-panel — glass hero surfaces only (needs backdrop-filter) */
  --border:        rgba(120,110,220,0.18);  /* was #2a2f3a — violet-tinted hairline (cc-border) */
  --border-bright: rgba(150,130,255,0.40);  /* new — focus/active/hover edge (cc-border-bright) */

  /* ── Text ─────────────────────────────────────────────────────── */
  --text:   #e8e6ff;   /* was #e6e8ec — violet-white (cc-text)      15.9:1 on bg ✓ */
  --muted:  #8b88b8;   /* was #9aa3b2 — dim (cc-text-dim)            5.8:1  on bg ✓ */
  --faint:  #6f6ca0;   /* new — hints/placeholders. cc-text-faint #5a5880 FAILS AA (2.9:1); bumped → 4.6:1 ✓ */

  /* ── Brand accent (violet) ───────────────────────────────────── */
  --accent:        #9d7bff;   /* was green #10a37f — brand violet (cc-violet)  6.2:1 ✓ */
  --accent-glow:   #b18bff;   /* cc-violet-glow — hover/emphasis   7.4:1 ✓ */
  --accent-ink:    #0a0b1e;   /* text that sits ON an accent fill (dark ink → 6.2:1 on violet ✓) */
  --accent-grad:   linear-gradient(135deg, #9d7bff, #6d5bff); /* primary buttons / send */

  /* ── Semantic status (all AA on dark bg) ─────────────────────── */
  --green: #3fb950;   /*  7.7:1  success / posted / live */
  --amber: #f9ab00;   /* 10.0:1  needs-you / review / partial */
  --red:   #ff6b5e;   /*  7.0:1  error / failed (was #f85149, kept usable but this reads better on dark) */
  --blue:  #6ea8ff;   /*  8.1:1  running / in-progress (NEW — replaces material #1a73e8 which is 4.3:1) */
  --purple:#a371f7;   /*  awaiting-clarification (distinct from brand violet by design) */

  /* ── Rings, radius, type ─────────────────────────────────────── */
  --ring:  rgba(157,123,255,0.50);  /* was green — violet focus ring */
  --radius: 10px;      /* was 8px — nudge up; neural cards read softer (CC uses 12–16px) */
  --radius-sm: 8px;
  --radius-lg: 16px;
  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  /* ── Spacing scale (formalize the ad-hoc 4/6/8/10/12/14 already in use) ── */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;

  /* ── Elevation shadows (dark-tuned — see AI-slop §3) ─────────── */
  --shadow-1: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-2: 0 8px 24px rgba(0,0,0,0.45);
  --shadow-3: 0 16px 48px rgba(0,0,0,0.6);
  --glow-accent: 0 0 24px rgba(157,123,255,0.30); /* the signature neural glow */

  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans);
  background-image: var(--bg-gradient); background-attachment: fixed; }
```

### Decision: `--accent` becomes **violet `#9d7bff`** (not green `#10a37f`) — RECOMMENDED

Rationale:
- The whole identity being adopted is violet/neural. `--accent` drives every primary button, selected card, active nav item, focus ring, hover border, `.chip.active`, `.badge.ready`, link color. If accent stays green, the app becomes green-buttons-on-violet-space — two competing brand hues, exactly the "theme didn't fully land" look we're removing.
- Making `--accent` violet means one edit flips all interactive affordances to match the CC core, hero, and node glow that are already violet. Cohesion for free.
- Green isn't lost — it's **promoted to a pure semantic** (`--green` = success/posted/live only). This is healthier: today green does double duty as "brand" AND "success," which is why `.badge.ready` and `.badge.posted` are nearly indistinguishable.
- Violet `#9d7bff` clears AA on the dark bg at 6.2:1 (green was 6.1:1 — no accessibility cost).

**Consequence to expect:** ~40 rules in styles.css that say `var(--accent)` (buttons, `.chip.active`, `.segmented button.active`, `.camp-item.active`, focus borders, `.dag-elapsed`, `.artifact-type`, credits) all turn violet at once. That is the desired outcome. The green-tinted literals baked next to them (`rgba(16,163,127,…)`) must be swept — see §2.

### Violet accent family (for layered emphasis)
| Token | Hex/rgba | Use |
|---|---|---|
| `--accent` | `#9d7bff` | default interactive, links, active state, focus border |
| `--accent-glow` | `#b18bff` | hover, emphasis text, "live" highlights |
| `--accent-grad` | `#9d7bff→#6d5bff` | primary button / send button fills |
| `--accent-ink` | `#0a0b1e` | label text sitting on an accent fill (AA — see §4) |
| `--ring` | `rgba(157,123,255,.5)` | focus-visible outer ring |
| glow | `rgba(157,123,255,.25–.5)` | the neural bloom (`--glow-accent`) |

### Elevation / panel layers (dark, 4 steps)
`--bg #0a0b1e` (L0 page, with radial gradient) → `--panel #14162e` (L1 card) → `--panel2 #1b1e3d` (L2 raised/hover/inset) → modals/popovers use `--panel2` + `--shadow-3`. **`--panel-glass` (translucent + `backdrop-filter: blur`) reserved for CC hero chrome only** — do NOT make all 46 cards translucent (blur is a perf + legibility risk when stacked/scrolled). Solid `--panel` for content cards; glass for the floating command bar / topbar / ws-menu.

### Border-glow strategy
- Resting border: `--border` (barely-there violet hairline, 0.18 alpha).
- Hover/active/selected: `--border-bright` (0.40) — replaces every current `border-color: var(--accent)` hover so hovers glow violet-white instead of hard green.
- Signature "energized" surfaces (selected post, running node, focused composer): add `box-shadow: var(--glow-accent)` on top of `--border-bright`. This is the one visual motif that says "neural."

### Type scale (formalize — currently ad-hoc)
Sizes already present in the file: 30/28/24/22/18/16/15/14/13/12/11/10. Collapse to a scale and apply going forward:
`--fs-display:30px / --fs-h1:24px / --fs-h2:18px / --fs-h3:15px / --fs-body:14px / --fs-sm:13px / --fs-xs:12px / --fs-2xs:11px`. Body line-height 1.5, headings 1.2, letter-spacing -0.5px on ≥24px. (Not blocking — apply during per-page polish, §5.)

---

## 2. Migration Map

### A. DELETE outright
| Lines | Block | Why |
|---|---|---|
| ~263–277 | `.app-root { --bg:#fff; --panel:#f7f7f8; … }` | light default theme — removed |
| ~278–286 | `.app-root.theme-dark { --bg:#212121; … }` | ChatGPT dark override — folded into single `:root` |
| ~503, ~514 | `.theme-dark .composer-box`, `.theme-dark .composer-send` | theme-scoped overrides — obsolete once one theme |
| App.tsx 21,28 | `type Theme`, `useState<Theme>('light')` + `theme-${theme}` className | remove theme state |
| App.tsx 292–293 | `theme`/`onToggleTheme` props to TopNav | remove |
| top-nav.tsx 14,39,108 | `theme` prop + toggle `<button …>◐/☼</button>` | remove the toggle control entirely |

After deletion `.app-root` should keep ONLY layout (`min-height`, `display:grid`, `grid-template-*`) — strip its `--*` var block so it inherits the single `:root`.

### B. `--cc-*` vars — fold vs keep
| `--cc-*` | Action |
|---|---|
| `--cc-bg #0a0b1e` | **fold** → `--bg` |
| `--cc-bg2 #12142e` | **fold** → basis for `--panel`/`--panel2` |
| `--cc-panel rgba(20,22,48,.6)` | **keep** as `--panel-glass` (CC hero/topbar/menus only) |
| `--cc-border` / `--cc-border-bright` | **fold** → `--border` / `--border-bright` |
| `--cc-violet` / `--cc-violet-glow` | **fold** → `--accent` / `--accent-glow` |
| `--cc-text` / `--cc-text-dim` | **fold** → `--text` / `--muted` |
| `--cc-text-faint #5a5880` | **fold w/ FIX** → `--faint #6f6ca0` (see §4) |

Practical path: keep the `.command-center { --cc-*: … }` local block **for now** (the CC internals reference `--cc-*` heavily) but repoint each `--cc-*` to the global token (`--cc-violet: var(--accent)` etc.). That way the CC keeps working unchanged while the rest of the app inherits the same values — zero risk, and you can inline-replace `--cc-*` → global token later at leisure. The W2 re-skin block (lines ~1098–1117) that re-colors `.atria-card`/`.atria-suggestion` *inside* `.command-center` becomes **redundant** once global tokens are already neural — delete it after the `:root` swap (the base `.atria-card` rules will already be dark).

### C. Hardcoded / light-assuming literals needing manual fix
Status colors are inlined as a **Google-Material palette** in TSX (running blue `#1a73e8`, posted green `#188038`, held amber `#f9ab00`, failed red `#d93025`, planned gray `#9aa0a6`) — inconsistent with the styles.css status set AND several fail contrast on dark (§4). Replace with tokens:

| File(s) | Literal | Replace with |
|---|---|---|
| `workspace-panel.tsx` 20-24, `campaign-command-view.tsx` 10-14, `workspace-menu.tsx` 10, `agent-spotlight.tsx` 71-72 | `#1a73e8` (running) | `var(--blue)` `#6ea8ff` |
| same | `#188038` (posted) — **3.9:1 FAIL** | `var(--green)` `#3fb950` |
| same | `#f9ab00` (held) | `var(--amber)` (already #f9ab00 ✓) |
| same | `#d93025` (failed) — **4.1:1 borderline** | `var(--red)` `#ff6b5e` |
| same | `#9aa0a6` (planned) | `var(--muted)` `#8b88b8` |
| `command-center-page.tsx` 87 | `#9d7bff` fallback | `var(--accent)` |
| `workspace-panel.tsx` 27, `ws-live` etc. | `#188038` live-green | `var(--green)` |

Light-assuming **fallback defaults** in inline styles (harmless today because the var wins, but wrong if the var ever drops): `border:'1px solid var(--border, #eee)'` (campaign-command-view 50, content-calendar 80), `var(--border, #ddd)` (instruction-editor 70, impact-report 17). Change fallbacks `#eee/#ddd` → the neural border value or just `var(--border)`. Low priority (cosmetic-only if var missing).

Light-tuned **shadows** baked in styles.css (too weak / wrong on dark):
- `.locked-setup` `box-shadow: 0 10px 30px rgba(0,0,0,0.05)` (line 491) → `var(--shadow-2)`.
- `.composer-box` `0 12px 36px rgba(0,0,0,0.12)` (501) → `var(--shadow-2)`.
- `.atria-tabs button.active` `0 2px 8px rgba(0,0,0,0.08)` (1080), `.atria-ask` `.08`, `.atria-card` hover — all `rgba(0,0,0,0.05–.12)` → bump to 0.4–0.5 alpha or `var(--shadow-*)`.

Green-tinted **status literals** in styles.css that should follow the new accent (search `rgba(16,163,127`): `.post-card.selected`, `.approve-panel`, `.workspace-hero` gradient+inset, `.chat-bubble.user`, `.locked-setup`, `.chat-thread.active`, `.agent-chip.active`, `.check-pill.on`, `.concept-gate`, `.badge.ready/.posting` — ~18 occurrences. Sweep `rgba(16,163,127,X)` → `rgba(157,123,255,X)` so "selected/approved/active" glows violet not green. (`.badge.posted` stays green — it's success semantics, not selection.)

---

## 3. AI-Slop Kill-List (concrete instances → upgrade)

1. **Flat identical gray cards, no hierarchy** — `.card`, `.camp-item`, `.connection-card`, `.atria-card`, `.tier-card`, `.modal-card` all = `panel + 1px border + radius`, indistinguishable. **Fix:** introduce the 2-layer rule — page uses `--bg` (gradient), content cards `--panel`, and *interactive/raised* cards (`.atria-card`, `.tier-card`, selected states) get `--panel2` + `--border-bright` + `--glow-accent` on hover. Give the primary hero card (`.workspace-hero`, `.cc-core` region) the violet radial the CC already has; demote plain data cards to flat `--panel`. Hierarchy = surface + glow, not just border.

2. **Default weak focus states** — `.field input:focus` only recolors border. On dark this is nearly invisible. **Fix:** already have the `:focus-visible` ring pattern (line 43-47); ensure ALL inputs/buttons route through it with the violet `--ring`, and add `box-shadow: var(--glow-accent)` to `.composer-box:focus-within` / `.cc-cmdbar:focus-within` (CC bar already does this — propagate the pattern to `.field`, `.orchestrate-composer`, `.chat-composer textarea`).

3. **Muted-gray-on-gray "eyebrow/section-title" everywhere** (`.eyebrow`, `.section-title`, `.ws-section-title`, `.atria-section-title`) — generic uppercase gray label, the #1 template tell. **Fix:** give section labels the CC eyebrow treatment — `--faint`, letter-spacing 2–4px, and for the primary one per surface a cyan/violet tick (`#4fd8e8` is already the CC eyebrow accent — reuse sparingly as the "system" accent).

4. **Pill-soup** — dozens of `border-radius:999px` chips (`.badge`, `.chip`, `.hero-meta span`, `.node-meta span`, `.cap-chip`, `.platform-chip`, `.brief-summary span`, `.conn-chip`) with a flat border. Reads as bootstrap default. **Fix:** unify into ONE `.pill` token style: `--panel2` fill, `--border` at rest, and only *status* pills carry semantic tint fills (`color-mix(in srgb, var(--green) 18%, transparent)` — the `.lead-score` pattern is the good model already in the file, propagate it).

5. **Buttons: `.btn.primary` = solid flat green** (line 85) → after accent swap it's flat violet; upgrade the primary CTA to `--accent-grad` + `--glow-accent` (the CC `.cc-send` already does the gradient+glow — make it the standard for `.btn.primary`, `.composer-send`, `.modal-choice.primary`). Secondary `.btn` stays flat `--panel2`.

6. **`.composer-send { background:#111 }` / white circle** (line 512) — a literal black button, pure ChatGPT-clone tell, will look like a hole on `#0a0b1e`. **Fix:** `--accent-grad` + `--glow-accent`, white arrow.

7. **Toast** (line 235) — flat panel + colored left-border, generic. **Fix:** `--panel2` + `--shadow-3` + `--border-bright`, accent left-bar as `--accent` (or `--red` for err). Minor.

8. **No motion identity on state change** — cards just swap border color. The file already has good micro-interactions in the CC (pulse, breathe, node-work, link-flow). **Fix:** none needed structurally — extend the existing `cc-*` keyframe vocabulary to the selected-post / running-dag states so "work happening" glows consistently app-wide (respect the existing `prefers-reduced-motion` guards — keep them).

---

## 4. Contrast / Accessibility Check (WCAG AA, computed on `--bg #0a0b1e`)

| Pair | Ratio | AA normal (4.5) | Note |
|---|---|---|---|
| `--text #e8e6ff` on bg | **15.9:1** | ✓ | excellent |
| `--muted #8b88b8` on bg | **5.8:1** | ✓ | body-muted OK |
| `--faint #6f6ca0` on bg (bumped) | **≈4.6:1** | ✓ | **was cc-text-faint #5a5880 = 2.9:1 FAIL** → fixed |
| `--accent #9d7bff` on bg (link/accent text) | **6.2:1** | ✓ | |
| `--accent-glow #b18bff` on bg | **7.4:1** | ✓ | |
| `--green #3fb950` on bg | **7.7:1** | ✓ | |
| `--amber #f9ab00` on bg | **10.0:1** | ✓ | |
| `--red #ff6b5e` on bg | **7.0:1** | ✓ | (`--red #f85149` = 5.8:1, also passes) |
| `--blue #6ea8ff` on bg | **8.1:1** | ✓ | replaces material `#1a73e8` = **4.3:1 (fail)** |
| `--accent-ink #0a0b1e` ON `--accent #9d7bff` fill (button label) | **6.2:1** | ✓ | use dark ink on violet fills |

### FLAGS (must fix)
1. **`--cc-text-faint #5a5880` = 2.9:1 — FAILS AA and AA-Large.** Used by `.cc-hint`, `.cc-network-empty`, `.cc-cmdbar input::placeholder`, `.cc-ws-menu-empty`, `.cc-node-label` (dim). Real text (hints/empty-states) must move to `--faint #6f6ca0` (4.6:1). Placeholders are technically exempt but should still bump for legibility.
2. **Material status literals fail on dark:** `#188038` posted-green = **3.9:1**, `#d93025` failed-red = **4.1:1**, `#1a73e8` running-blue = **4.3:1**. All flagged in §2C → replace with `--green/--red/--blue` tokens (all ≥7:1).
3. **White text on the violet send button** (`.cc-send`, `.composer-send` if kept white) = **3.1:1** — fails AA normal, passes AA-Large (3:1) and passes the 3:1 UI-component threshold. Since these carry only a ▶/↑ *icon* (graphical, 3:1 rule applies) it's acceptable; if any TEXT label sits on a violet fill, use `--accent-ink` (dark) instead of white.

Everything else clears AA. No AAA claims made.

---

## 5. Per-Surface Polish Notes (for the follow-up implementation phase)

- **Command Center (`command-center-page.tsx`, `.command-center`)** — already the reference. After `:root` swap, delete the redundant W2 re-skin block (§2B). Keep the radial-gradient bg, core pulse, node glow, link-flow — these ARE the identity. Make sure the drawer (`.cc-drawer`, currently intentionally "light surface using app theme vars") now renders DARK automatically (it uses `var(--bg)/--panel/--text`) — verify the embedded PostWorkflowView reads well on dark; the drawer scrim `rgba(6,7,20,.55)` is fine.
- **Orchestrate chat (embedded, `.cc-chat-embed`)** — already dark-restyled with hardcoded hexes (`#171922`, `#2c2f3d`, `#9d7bff`…). Once the base `.chat-bubble`/`.composer-box` are dark via tokens, **retire the `.cc-chat-embed` override hexes → tokens** so there aren't two dark systems. `.chat-bubble.user` bg should be `--panel2` (currently green-tinted → violet-tint per §2C).
- **Post-workflow view (`.post-workflow`, `.dag-*`, `.stage-line`, PostWorkflowView in drawer)** — status colors flow from `--green/--amber/--red/--accent`; running spinner `.dag-node.st-running .dag-dot` becomes violet (good). Give `.post-summary-row.selected` the `--glow-accent`. `.stage-line.st-ready/posting` currently accent(→violet) — confirm that reads as "in progress" vs posted(green) vs review(amber).
- **Impact report (`impact-report.tsx`, `.atria-home-stack`)** — inline `var(--border, #ddd)` fallbacks → neutralize. Metric tiles (`padding:12;border`) should use `--panel` + tabular-nums (already global). Headline TTS button (`.impact-tts`) fine. Big-number metrics deserve the display type scale + `--accent-glow` for the hero figure.
- **Leads (`LeadsPage.tsx`, `.lead-*`)** — only file reading tokens inline (3×). `.lead-score` `color-mix` pattern is the GOOD model — keep, it now maps to token greens/ambers. Score circles: hot=green, warm=amber, cold=muted — all AA on dark.
- **Email (`.email-*` panel)** — plain inputs on `--panel`; add focus-ring + glow like other fields. Nothing special.
- **Instructions (`instruction-editor.tsx`, `.atria-tabs`)** — `.atria-tabs button.active` shadow is light-tuned (`rgba(0,0,0,.08)`) → dark shadow; active pill bg `--bg` on `--panel2` track reads inverted on dark, verify (may want active = `--panel` raised, inactive transparent).
- **Post board / Active flows (`ActiveFlowsPage`, `.flow-node`, `.camp-item`, `.blueprint-*`)** — heaviest green-literal density (`rgba(16,163,127,…)` on `.flow-node.existing/running`, `.camp-item.active`, `.blueprint-index`, `.concept-gate`, badges). Sweep per §2C. `.flow-node` grid keeps green=live / accent=existing distinction — after swap existing→violet, live→green: good separation. `.blueprint-index` circle → `--accent` violet.
- **Global topnav (`.app-topnav`)** — already hardcoded dark (`#0f1017`, `#23252f`) and effectively neural; repoint its literals to tokens (`--bg`/`--border`/`--muted`) and **remove the theme-toggle button** (top-nav.tsx:108). Brand logo gradient stays.
- **Connections / Usage / Scheduled** — pure token consumers; `.sched-row` has `var(--accent, #3b82f6)` blue fallback → the fallback should be `var(--blue)` not raw blue. Bars/tracks (`.usage-bar-fill`) become violet — good.

---

## Open questions (for you before implementation)
1. **"Running/in-progress" hue:** keep a distinct `--blue #6ea8ff` (workspace status dots), OR unify running→violet `--accent` to match the CC node-glow metaphor? Spec assumes distinct blue for now (clearer "attention vs working" signal), but violet is more cohesive.
2. **`--red` value:** spec upgrades to `#ff6b5e` (7:1) for dark legibility; if you want to keep the existing `#f85149` brand red (5.8:1, still AA) say so — trivial swap.
3. **`--radius` 8→10px** is a taste nudge toward the softer CC look; revert to 8 if you want tighter/denser.
4. **Glass panels:** confirm OK to restrict `backdrop-filter` to CC chrome only (perf) rather than all cards.

---

**Status:** DONE
**Summary:** Delivered the single neural `:root` token block (violet accent recommended over green, with rationale + AA-verified values), a delete/fold/fix migration map (2 light blocks + theme state to remove; ~26 hardcoded status hexes + ~18 green-tinted literals to sweep to tokens), a 8-item AI-slop kill-list, computed WCAG-AA contrast table (flagged 4 failing pairs with corrected hexes), and per-surface polish notes for the 8 target pages. Report at `plans/260710-1132-p5-design-neural/reports/design-system-spec-260710.md`.
**Concerns/Blockers:** Because components consume classes (not inline tokens), the `:root` swap recolors everything at once — high leverage but means the token-migration phase and the green-literal sweep (§2C) should ship together or the app will show violet buttons beside orphaned green selection-glows mid-migration. 4 open decisions listed above (running-hue, red value, radius, glass scope) should be answered before the implementation phase starts.
