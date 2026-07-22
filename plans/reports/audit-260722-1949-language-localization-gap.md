# Why the "localize everything" rule keeps leaking — 2026-07-22

Triggered by F13 (nurture emails written in the owner's language, not the lead's) and the question:
*"I asked for this to be applied globally — why are there still language issues?"*

Answer: it was never one bug being re-broken. There are **two independent language systems**, and the rule
was recorded as a convention in neither of them.

## 1. Content language (backend) — many deciders, no seam

Language is decided independently at each goal-producing site, each with its own fallback chain:

| Producer | Sets `slots.language`? | Terminal fallback | Status |
|---|---|---|---|
| Chat → `propose_workflow` / `propose_task` | yes, `contentLanguageFor` | `'en'` | ✅ fixed `766184f` (F7) — was English for all Latin scripts |
| `POST /tasks` (`orchestration-router.ts:401`) | yes, but no declared language available | `'en'` | ⚠ open — a Latin-script document task still defaults to English |
| Nurture `buildTouchGoal` / `buildReplyGoal` | **no — never set** | `user.defaultLanguage` | ✅ fixed today (F13) |
| Campaign materializer | yes, from `campaign.language` | — | ok |
| DM writer (`dm-runners.ts:25`) | inherits goal | `'en'` | ⚠ open, and note the default differs from email's `'vi'` |
| Media/copy (`resolveRunLanguage`) | reads the goal | `user.defaultLanguage` → `DEFAULT_LANGUAGE='vi'` | ok as a *chain*, wrong as a *default* when the goal is silent |

The pattern: `resolveRunLanguage` is a perfectly good chain, but it is only as good as whoever filled
`slots.language`. Every new node that forgets inherits the workspace default silently — no error, no test.
That is exactly how F13 shipped.

### Fixed today

`runEmailWriter` now resolves the language of an email to a **counterparty** from the counterparty, in
this order: explicit goal language → the lead's message when its script is unambiguous → *mirror the
lead's quoted message* when it is Latin-script (no code can tell `id` from `en`) → the old owner-default
chain only when there is no lead at all.

**Guarded mechanically** in `verify-nurture-email-from-chat.ts` (+5 checks, db tier): a Vietnamese lead
pins `vi`; a Latin-script lead gets the mirror instruction and provably **not** the workspace default; an
explicit goal language still wins. These checks fail against the pre-fix code.

**Proven live** on the real account (`defaultLanguage: vi`), same lead, before → after:

> `Chào Script5, Cảm ơn bạn rất nhiều vì đã liên hệ…`
> `Hai Script5, Terima kasih banyak atas minat Anda pada Kursus AI Automation kami…`

## 2. Interface language (frontend) — there is no i18n at all

Swept all 74 files in `MKTAgent/web/src`. Searched for `i18next`, `react-intl`, `lingui`, `formatjs`,
`t(`, `useTranslation`, locale/messages directories, any language context. **Zero hits.**
`web/package.json` depends on exactly `react` + `react-dom`.

| metric | count |
|---|---|
| Hardcoded user-facing strings | **≈ 830** |
| Of those, copy the user must ACT on (approve / connect / pay / retry) | **≈ 250** |
| Hardcoded **Vietnamese** strings in an otherwise-English UI | **17** (exhaustive diacritic scan) |
| Components mixing EN and VI **inside one component** | **6** |
| Raw backend error codes interpolated into toasts (`${r.error.error}`) | **87** across 27 files |

Meanwhile `components/form-options.ts:37-67` offers the user **31 content languages** as native endonyms.
The product promises to *write* in 31 languages through an interface that speaks one — and that one is
inconsistently English or Vietnamese depending on the file.

So this is not "i18n is incomplete". **i18n was never started.** There is no seam to add a translation to,
which is precisely why each of the 7 recurrences was fixed as a one-off string edit.

### Fixed today (bleed-stop only, not a solution)

| Site | Was | Now |
|---|---|---|
| `workspace-panel.tsx:162`, `scheduled-view.tsx:118`, `post-workflow-view.tsx:248` | `≈ 1,200 cr?` + **`Xác nhận`** / **`Huỷ`** | single-language `Confirm` / `Cancel` |
| `impact-report.tsx:47` | one Vietnamese sentence spliced into an English spoken narration | English, matching the rest |
| `use-speech-recognition.ts:94` + `OrchestratePanel.tsx:112` | `rec.lang = 'vi-VN'` for **every** user | follows `navigator.language` |

The credit-grant one was the worst of the set: a **money-authorization** dialog asking in English and
offering its Yes/No buttons in Vietnamese, repeated in three files — one authoring accident copy-pasted.

The speech default was a functional defect, not cosmetics: an Indonesian or Korean speaker's voice was
transcribed against a Vietnamese acoustic model.

### Still open — needs a decision, not a patch

1. **~250 act-on strings have no localization path.** Adding one requires choosing an i18n approach first.
2. **Two of the most load-bearing sentences originate server-side**, so a frontend-only i18n cannot reach
   them: the publish gate (`workflow-executor.ts:366`, "Connect X to publish — your draft is ready and
   waiting.") and node errors rendered verbatim at `run-dag-view.tsx:115` (this is where
   `email_agent: send failed (gmail_not_connected)` surfaces). Any i18n plan must cover the API surface,
   not just the components.
3. **87 raw error identifiers** reach users as messages. These need an error-code → human-sentence map,
   which is the natural place to attach translation.
4. `scheduleConfirmTail` (F11) and the lead scoring reasons (O3) are the same class on the backend.

## The durable lesson

A rule recorded in memory governs nothing. This one survived seven recurrences because every fix was
applied at the site that happened to be observed, while the *mechanism* that produces the defect — a
language decided independently at ~6 backend sites and 830 frontend literals — stayed untouched.

What changed today is small but different in kind: the counterparty-language contract is now asserted by
tests that fail if a future path forgets. That is the only form of "global" that holds.

## Unresolved

1. Which i18n approach for the frontend, and does it cover server-authored user-facing strings?
2. Is the `'en'` vs `'vi'` split in terminal defaults (DM vs email/media) intentional?
3. Should an explicit goal language really outrank the recipient's own language for a lead email, or was
   that only right for the birthday-note case observed in script 4?
