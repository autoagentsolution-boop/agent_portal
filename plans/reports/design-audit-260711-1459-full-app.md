# Full-App Design-Consistency Audit — Atria / MKTAgent web

Date: 2026-07-11 · Auditor: UI/UX · Scope: `MKTAgent/web/src` (Vite/React/TS, single stylesheet `styles.css` 1324 lines, 47 components). Audit only — no code changed.
Owner's 3 complaints verified: (1) pages/tabs inconsistent, (2) text unclear, (3) messy style. **All 3 confirmed, with root causes below.**

---

## 1. Design-system health summary

**Verdict: a real token system EXISTS but is only ~half-adopted, and it competes with 3 rival hardcoded palettes.** Health = **C+ / drifting**.

What's good (`styles.css:1-44`):
- One coherent token root: surfaces (`--bg`→`--panel`→`--panel2`), text (`--text/--muted/--faint`), violet accent, semantic status (green/amber/red/blue/purple), radii (`--radius 10/8/16`), shadows, glow. Genuinely well-designed.
- Status colors are consistently applied via `.st-*` and `.badge.*` classes — the ONE area with real consistency.
- Focus-visible ring + reduced-motion handling exist (good a11y baseline).

What's broken (the drift):
- **Spacing scale defined but adoption = ZERO.** `--sp-1..8` declared (`styles.css:35`) then used **0 times** (`grep var(--sp- = 0`). Every padding/margin is a raw px. Result: 15+ competing padding values (`14px`, `10px`, `8px`, `12px`, `9px`, `28px 20px`, `12px 14px`…).
- **No type scale.** 20 distinct font-size values in one file: `8,9,10,11,11.5,12,12.5,13,14,15,16,17,18,19,20,22,23,24,28,30 px`. Odd values `11.5 / 12.5 / 17 / 19` = pure organic drift. `12px`×62, `13px`×51 — the workhorses, but no named tokens so every component re-guesses.
- **4 parallel color palettes** (detail in Finding C1) — the token system, the top-nav hardcoded set, the cc-chat-embed hardcoded set, and light-theme fallback hex left in `var(--x, #eee)`.
- **131 inline `style={}`** across 23 files (LeadsPage 26, ProductKnowledgeLibrary 16, pk-upload 14, impact-report 12, campaign-command 8, instruction-editor 7, PostCard 7). Layout invented per-page instead of shared classes.
- Filename casing mixed PascalCase + kebab-case → confirmed organic-growth signal; matches the CSS drift.

---

## 2. Findings (ranked)

### CRITICAL

**C1 — Four competing color palettes; the always-visible top nav is off-system.** (complaint #3 + #1)
- Token system: `--bg #0a0b1e`, `--panel #14162e`, `--accent #9d7bff`.
- **Top-nav (`styles.css:437-475`) is hardcoded, NOT tokens:** `#0f1017` bg, `#23252f` border, `#e7e8f0` text, `#b6b8c8` dim, `#2c2f3d`, `#8a8ca0`, `#40435a`. The bar on screen at all times lives on its own near-duplicate greys. Re-tune any `--panel` and the nav desyncs.
- **cc-chat-embed (`styles.css:397-411`) = a THIRD hardcoded dark set:** `#171922`, `#14151d`, `#262838`, `#dfe1ee`, `#6d7085`, `#eceefb`. Same Atria chat looks different embedded (CC) vs standalone (token-based `.chat-bubble`, `styles.css:493-495`).
- **Off-brand cyan `#4fd8e8`** (`cc-eyebrow :947`, `cc-logo :929`) appears nowhere else — a second accent fighting the violet identity.
- Fix: promote the top-nav + cc-embed hex to tokens (`--panel/--panel2/--border/--muted`). Kill `#4fd8e8` or elevate it to a real `--accent-2` token used intentionally. This single change makes nav+chat+body read as one product.

**C2 — Light-theme fallback hex left inside `var()` — wrong-color risk + proof of pre-system code.** (complaint #3)
- `var(--border, #eee)` and `#ddd` (`campaign-command-view.tsx:50`, `content-calendar.tsx:80`, `impact-report.tsx:17`, `instruction-editor.tsx:70`).
- `var(--accent, #3b82f6)` **blue** and `var(--accent, #2a2a2a)` (`scheduled-view` rows `styles.css:1313-1320`), `var(--accent, #2f9e6f)` **green** (`dag-targets :699`), `var(--green, #3fb950)` (`:353`).
- These fallbacks are from before the neural theme. If a token ever fails to resolve, UI flashes light-grey/blue/green. Fix: delete all `, #xxx` fallbacks — tokens always resolve now.

### HIGH

**H1 — No shared page shell → every tab has a different width, padding, and header.** (complaint #1, the core "pages không đồng nhất")
- Content max-widths across tabs: `560` (plan-tier), `720` (instruction-editor `:47`), `760` (orchestrate/connections/usage — the only 3 that match), `820` (impact `:55`, campaign-command `:38`), `860` (atria-hub), `900` (scheduled), `980` (master-chat), `1080` (master-home). **8 different content widths** → nothing lines up as you navigate.
- Page padding also varies: `28px 20px` / `24px 20px` / `14px` / `16px 20px`.
- Page headers hand-rolled per page: LeadsPage/PKLib `<h2 style={{fontSize:18}}>` + emoji (`LeadsPage.tsx:168`), impact `<h3>` (`impact-report.tsx:56`), atria-hub `h2` 24px, orchestrate default `<h2>`, cc-head `h1` 30px. Heading sizes 18/24/28/30 + browser defaults, no rule.
- Fix: add one `.page` (max-width, centered, padding tokens) + `.page-header` (title size, eyebrow, subtitle) and apply to every tab. Biggest single win for consistency.

**H2 — `--faint #6f6ca0` fails WCAG AA as body text.** (complaint #2)
- Contrast `--faint` on `--bg` ≈ **4.0:1**, on `--panel` ≈ **3.6:1** — below 4.5 AA for normal text. Used as real content, not just placeholder: `cc-hint :1105`, `cc-network-empty :1090`, `cc-ws-menu-head/empty :1155/1158`, `cc-cmdbar input::placeholder :1097`.
- Fix: lift `--faint` to ~`#8a86bd` (≈4.6:1) or only use it ≥16px/bold. Reserve `--muted` (passes ~5.3–5.8:1) for secondary text.

**H3 — impact-report is 100% inline-styled and skips shared cards.** (complaint #1+#3)
- `impact-report.tsx:17-20` builds metric cards inline (`padding:12, border:1px solid var(--border,#ddd), radius:8, fontSize:22`) instead of `.card`/`.metric`. So Impact's tiles look unlike `.metric` (`styles.css:193`) and `.flow-cost` tiles used elsewhere → the analytics tab reads as a different app.
- Same pattern: LeadsPage (26 inline), PKLibrary (16), instruction-editor, campaign-command. Fix: replace inline metric/list/section blocks with `.card`, `.metric`, `.section-title`, `.post-summary-row`.

### MEDIUM

**M1 — Tiny low-contrast labels.** (complaint #2) `8px` (`cc-node-soon :1079`), `9px` (`cc-eyebrow`, `cc-core-label :1069`, `cc-core-sub`, `ws-live :1198`), `10px` uppercase muted (`node-meta :224`, `cc-node-label :1086`, `badge` 11px). Uppercase + letter-spacing + muted at 9-10px is a legibility floor. Fix: min 11px for labels, 12px for any real content; bump `cc-core-label` to 10px.

**M2 — Odd off-scale font sizes** `11.5px` (`ws-grant-btn :416`, `topnav-item :448` 12.5), `17px` (impact headline `:60`), `19px` (`flow-cost-credits :865`). Snap to a 12/13/14/16/18/20/24 scale.

**M3 — Two heading conventions for emoji titles.** LeadsPage & PKLib inline-emoji `<h2>` at 18px; impact uses `<h3>`; atria/workspace use `.eyebrow` + big `h2`. Pick one title pattern (eyebrow + 18–20px title) app-wide.

**M4 — `--radius` token exists (10/8/16) but many components hardcode `6px`, `7px`, `8px`, `9px`, `12px`, `14px`, `28px` radii** (`.btn :115` 6px, `.field input` 6px, `composer-box :523` 28px, `.atria-card :1258` 12px). Buttons/inputs at 6px vs cards at 10-12px vs pills 999px is defensible, but 6/7/8/9 all coexist arbitrarily. Consolidate to `--radius-sm 8` / `--radius 10` / `--radius-lg 14`.

### LOW

**L1 — Scrollbar/gradient/glow values duplicated as raw rgba** (`rgba(157,123,255,x)` ~40+ times). Could become `--accent-rgb` for `rgba(var(--accent-rgb), .3)`. Cosmetic/maintenance only.
**L2 — `.dag-targets` labelled with a green fallback but named "targets" uses accent** — semantic color confusion, minor.
**L3 — `--panel-glass` + `backdrop-filter: blur` used in CC only; fine, but ensure fallback bg on unsupported browsers.**

---

## 3. Quick wins for demo (top 5, cheapest → highest impact)

1. **Delete every `var(--token, #hex)` fallback** (C2) — 6 files, find/replace. Removes any chance of a light-grey/blue/green flash on the dark demo. ~10 min.
2. **Tokenize the top-nav** (C1) — swap the 7 hardcoded greys in `styles.css:437-475` for `--panel/--panel2/--border/--text/--muted`. The persistent bar instantly matches the body. ~15 min, huge perceived-consistency gain.
3. **Lift `--faint` to `#8a86bd`** (H2) — one line (`styles.css:15`). Fixes the "chữ chưa rõ" on hints/placeholders/empty states app-wide. ~2 min.
4. **Add a `.page` wrapper class** (`max-width:820px; margin:0 auto; padding:24px 20px`) and drop it on impact/instruction/leads/campaign/plan-tier sections (H1). Normalizes width+padding so tabs align. ~20 min.
5. **Standardize the page header** — one `.page-header` (eyebrow 11px uppercase muted + title 20px). Replace the 4 hand-rolled title styles (H1/M3). ~20 min. Together 4+5 kill the "pages lung tung" impression.

---

## 4. Systemic recommendations

- **Adopt the spacing scale you already wrote.** Replace raw px with `var(--sp-*)`; it's declared and used 0×. Even partial adoption on padding/gap enforces rhythm.
- **Add a type scale as tokens** (`--fs-xs 11 / --fs-sm 12 / --fs-base 13 / --fs-md 14 / --fs-lg 16 / --fs-xl 20 / --fs-2xl 24`) and map the 20 ad-hoc sizes onto 7. Kill 11.5/12.5/17/19.
- **One source of truth for dark surfaces.** Fold top-nav + cc-chat-embed hex into the tokens; delete the parallel palettes. Decide if cyan `#4fd8e8` is a real secondary accent (then `--accent-2`) or noise (delete).
- **Kill inline styles → shared classes.** 131 inline styles is the drift engine; each is a page inventing its look. Convert layout inline styles to `.card/.metric/.section-title/.row/.page`. New rule: no `style={}` for anything reusable.
- **Contrast gate:** body/secondary text must use `--text` or `--muted` (both pass AA); `--faint` only ≥16px or decorative. Min font-size 11px, 12px for content.
- **Radii consolidation** to 3 tokens.
- Longer term: extract `styles.css` (1324 lines, one file) into `tokens.css` + per-surface partials; it violates the repo's 200-line file rule and makes drift invisible.

---

## Unresolved questions
1. Is cyan `#4fd8e8` an intentional secondary brand accent (JARVIS/HUD vibe) or leftover? Determines keep-as-`--accent-2` vs delete.
2. Are the 3 matching pages (orchestrate/connections/usage @760px) the intended canonical width, or is 820px (impact/campaign) the target? Need the owner's preferred content width before standardizing `.page`.
3. Is the CC "Neural Network" landing meant to feel deliberately distinct from the utility tabs (different padding/scale acceptable), or should it unify too? Affects how aggressively H1 applies to `command-center-page`.
4. Vietnamese diacritics not stress-tested here (audit was code-based) — confirm `Geist` renders ă/â/đ/ê/ô/ơ/ư at the small 11-12px sizes without clipping line-height.
