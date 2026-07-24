# Session handoff — 2026-07-24 · i18n COMPLETE, observed test resumes at 6b

Cold-start doc. Supersedes the pre-test handoffs for what changed on 2026-07-24.
Branch `pivot/video-content-farm`, head `43d861b`, clean, **all pushed**.

## What happened this session (2026-07-24)

1. **Google reconnected + live-verified** (was the F14 blocker). `google_drive_refresh_token` on the
   user's tenant `6455c2bd-67cc-48cb-ab77-5ead25747d02` refreshes; scopes `drive.file`+`gmail.send`+
   `gmail.readonly`. → 6b/9/10 (Gmail) and 11 (Drive media) are UNBLOCKED.
2. **Full i18n track shipped** (was the "language keeps leaking" root-cause plan). See below.
3. **Observed test 6b NOT started** — the i18n work took the whole session at the user's direction
   ("fix vấn đề liên quan plan rồi test tiếp" → then "add all languages, verify E2E before finalizing").

## i18n — DONE, 30 UI languages, live-verified (commits `c13c6b6`→`43d861b`)

- **Interface language ≠ content language.** `User.uiLanguage` (nullable, follows browser) drives the UI;
  `defaultLanguage`/`slots.language` still drive what agents WRITE. `verify-i18n` bans `uiLanguage` in
  `src/orchestration/**` so they never conflate.
- **Runtime:** `web/src/i18n/` — dependency-free `t()`, `LocaleProvider`, `useLocale`, English fallback,
  `{param}` interp, typed `MessageKey` (wrong key = build error). `t-error.ts` renders API error CODES.
- **The whole UI switches:** ~26 components migrated (landing, nav, all pages, cards). 713 English keys.
- **30 languages:** en (typed `catalog.en.ts` source) + 29 `catalog.<code>.json` (vi id ko fr th ja zh
  zh-TW ms tl km lo my es pt de it nl ru uk pl tr hi bn ta ur fa ar he). **RTL** (ar/he/fa/ur) flips
  `document.dir`. Live-proven: KO, FR, **AR with full RTL layout** (screenshots in scratchpad).
- **Data-driven registry:** `web/src/i18n/locales.ts` is the SINGLE source (code+endonym+English
  name+rtl). Add a language = 1 row there + `npm run i18n:translate -- --locale <code> --ship-act-on`.
  `index.ts` glob-loads all catalog JSON. Server allow-list `src/i18n/ui-languages.ts` = 30 codes.
- **GLOBAL enforcement:** `verify-i18n.ts` (unit tier) scans ALL `web/src/*.tsx`; a raw user-facing
  literal in a `notify/confirm/alert/prompt/show/toast` sink FAILS CI. `i18n-exempt.json` = shrinking
  legacy backlog (6 files: App.tsx, CampaignList, CampaignSetupForm, PostBriefForm, concept-copy-editor,
  create-post-modal). New files are guarded by default. `// i18n-ignore` for genuine one-offs.
- **Pipeline** (`npm run i18n:translate`): diffs missing keys → Gemini (`surface='i18n'` ledgered) →
  param-set validation (rejects a dropped/invented `{token}`) → batch-retry on malformed JSON +
  per-key retry when a lang drops a placeholder (ar/he needed this) → writes sorted JSON. Act-on keys
  recorded to `catalog.<code>.review.json`.
- **F11 fixed** (`conversation-author.ts`): `scheduleConfirmTail` was vi/en only → localized over the
  launch set, in the REPLY's content language (never uiLanguage).
- 72/72 verify green; BE + web `tsc --noEmit` clean.

### i18n — known gaps (NOT chrome, deliberate)
- **Server-authored content stays English regardless of uiLanguage:** the Atria SUGGESTION cards
  (`atria-suggestions` `headline`/`rationale`) and agent NAMES. Localizing needs the server to send
  CODES (like the error envelope), a separate effort. Agent GROUP labels ARE localized (client id→key).
- **Act-on quality:** for fr onward, act-on strings are pipeline-GENERATED and `--ship-act-on`-promoted
  (recorded in `catalog.<code>.review.json`). vi/id/ko act-on were hand-authored. A native pass is owed
  before trusting production money/delete strings in the generated languages.
- Phase 06 remaining decorative strings live only in the 6 exempt files above.

## RESUME the observed test at script 6b

Order (from `project_observed_live_test_260722.md`, still current except F14 now cleared):
1. **Restart the stack** — this session's BE/web were force-killed twice (unexplained). Docker Postgres
   `mktagent-postgres-1` (:5433) stays up. Bring up: `docker compose up -d postgres` (if down) in
   `MKTAgent/`, then `npm run dev` (BE :7100, tsx watch) and `cd web && npm run dev` (:5173).
2. **Google is alive** — no reconnect needed. Verify if paranoid: refresh the token (recipe in the
   observed-test memory).
3. **Re-mint the browser session** — cookies expire ~1h. Headed Chromium CDP :9333 may still be open
   (it survived the kills); relaunch via `plans/260714-0015-.../launch-observed-browser.sh` if not, but
   mint the cookie for the USER's tenant `6455c2bd…`, not the seed tenant:
   `npx tsx -e "import('./src/lib/session.ts').then(async m=>{const s=await m.createSession('6455c2bd-67cc-48cb-ab77-5ead25747d02','x');console.log(s.handle);process.exit(0)})"`
   then in the page `document.cookie='mkt_session=<handle>; path=/; max-age=2592000'; location.reload()`.
   ⚠ agent-browser `cookies set` / `click` sometimes hang — use `eval(...)` (document.cookie, el.click()).
4. **Script 6b** = upload doc → summarize + Data Guard → email. **Language: use KO** (spread so far
   VI·EN·ID·ID). Real Gmail sends from the user's account; the harness BLOCKS outward send clicks →
   **the user must click "Approve & send" themselves**.
5. Then scripts 9, 10 (email), 11 (video — expect **F1**: VN on-image text corrupts, `nano-banana.ts:21`
   hardcodes `gemini-2.5-flash-image`, no Pro option — still unfixed).

Leftovers to delete on the LIVE account when the user says so: test lead `a3ad8bb8…`
(`auto.agent.solution+leadtest@gmail.com`), its nurture thread `65d1e23f…`, and the intake token.

## Open items (unrelated to test flow)
- **F1 unfixed** (VN on-image text) — hits script 11.
- i18n act-on native review for generated languages (fr+).
- i18n server-content localization (suggestions, agent names) — separate track if wanted.
