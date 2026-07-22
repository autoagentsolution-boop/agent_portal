# Observed live test — script 4 + F7 fix — 2026-07-22 (session 2)

Continues `test-260722-1622-observed-live-test.md`. Same tenant `ce155aa5-…`, same safety config
(`ENABLE_LIVE_SOCIAL_PUBLISH=false`, leads repointed to `auto.agent.solution+<name>@gmail.com`).
Stopped after script 4 at the user's instruction.

## F7 — FIXED and live-verified

Latin-script languages no longer fall through to English.

**Change:** the conversational brain now DECLARES the language of the user's message
(`message_language`, a required arg on `propose_workflow` + `propose_task`), and
`contentLanguageFor(message, prior, declared)` uses it as the third rule — after script detection and the
established prior, before the `'en'` default. Files:

| File | Change |
|---|---|
| `master/detect-language.ts` | 3rd param `declared` + `latinDeclared()` filter; `SCRIPT_DETECTABLE` derived from `SCRIPT_PROBES` |
| `atria/atria-tools.ts` | `message_language` declared on both tools, passed at both `contentLanguageFor` call sites |
| `prompts/atria-brain-prompt.ts` | LANGUAGE rule now ties the reply language to the tool arg |
| `verify-master.ts` | +11 checks |

**Anti-bleed guard held.** The declaration is accepted ONLY for codes the script detector cannot see.
`detectLanguage` returning null proves the message contains no VN diacritics and no non-Latin script, so a
declared `vi`/`th`/`ja`/… contradicts the text and is refused → `'en'`. That is exactly the memory-bleed
signal the original design deliberately ignored, so the fix cannot reopen it. Precedence unchanged:
script detection > established prior > declaration > `'en'`.

**Live proof (script 4, 100% Indonesian conversation):**

| | before (script 3) | after (script 4) |
|---|---|---|
| `goal.slots.language` | `en` ❌ | **`id`** ✅ |
| generated content | English copy | "Halo Nghiep,\n\nSelamat ulang tahun! Semoga harimu menyenangkan…" ✅ |

`npm run verify:unit` → ALL 21 PASSED.

## Script 4 — schedule a birthday email (ID) — ⚠ partial

Routing, lead resolution, time parsing, email drafting and language were all correct. The **schedule was
silently lost** and the send could not be exercised (no Gmail credential on the tenant).

### F8 🐛 MAJOR — a parsed schedule is dropped unless propose_workflow runs in the SAME turn

Turn 1 ("…jadwalkan besok jam 9 pagi") → Atria called `find_lead` + `set_schedule`, replied
*"sudah menjadwalkan pengiriman email untuk besok, 23 Juli 2026, jam 09:00 pagi Waktu Bangkok"*, and asked
to confirm — but did **not** call `propose_workflow`, which `set_schedule`'s own tool note tells it to do
in that same turn.

`ctx.scheduleProposal` lives only for the duration of one turn (`atria-brain.ts:159`). Nothing persists it.
The only cross-turn carrier is `priorGoal.schedule` — and `priorGoal` comes from a PRE_EXEC run
(`orchestration-router.ts:266/311`, `PRE_EXEC = {awaiting_clarification, planned, failed, planning}`).
A reply-only turn produces an `answered` run with a **null goal**, which PRE_EXEC excludes. So the parsed
instant is unrecoverable the moment the turn ends.

Observed result — the flow built two turns later:

```
wf_run 973e694a… | status planned | language id | needsEmail true | schedule NULL
wf_node_run       n1 email_writer  completed
                  n2 email_agent   awaiting_approval   ← immediately, no scheduler node
```

**Failure scenario:** user asks for a birthday email tomorrow 09:00; Atria states that time back
confidently; the flow contains no `scheduler` node; on approval the email is sent **today**. A birthday
greeting arrives a day early, and the user was told otherwise.

Frequency: 1 of the 2 schedule flows observed across both sessions (script 3 worked — the brain did call
`propose_workflow` that turn). Not caused by the degraded turn — the loss already happened on turn 1.

**Fix shape:** the codebase already has the precedent at `orchestration-router.ts:268-274` ("the reasoning
brain is unreliable for edits here … so re-plan deterministically"). Same treatment: when a turn ran
`set_schedule` and ended without a proposal, either (a) force the `propose_workflow` executor
deterministically (kind from `parseEmailIntent`, language from the same declaration), or (b) persist the
proposal so the next turn can seed `ctx.scheduleProposal`. (a) matches the tool's stated contract and needs
no schema change.

### F8 — FIXED, and the schedule proven created end-to-end

**Change:** `rescueScheduleProposal(ctx)` (`atria-tools.ts`) — when a turn ends with no proposal but
`ctx.scheduleProposal` is set, the draft flow is built deterministically instead of letting the instant
die with the turn. Called from the one place a turn can end cleanly (`atria-brain.ts`, the `!calls.length`
branch), so it never preempts a brain that was going to call `propose_workflow` itself. `kind` comes from
`parseEmailIntent`; the schedule rides UNconfirmed, so the user still confirms before anything is spliced.

The language declaration moved onto the context (`ToolContext.messageLanguage`, captured in `dispatchTool`
from any tool's `message_language`, now also declared on `set_schedule`) so the rescue path resolves the
same language as the normal path — otherwise the rescue would have re-opened F7.

**Live proof, Indonesian, same request as above:**

```
wf_run 79176c4d… | scheduled | language id | schedule.confirmed true | scheduled_resume_at 2026-07-23 02:00+00
  n1 email_writer  completed     ← body: "Selamat ulang tahun, Nghiep! …"
  n2 scheduler     completed     ← parked the run
  n3 email_agent   pending       ← resumes 09:00 Bangkok, does not send now
```

⚠ **The rescue path itself did not fire in this run** — the brain called `propose_workflow` in the same
turn as `set_schedule` this time (the correct path), so what is proven live is the happy path plus the
language fix. The rescue is typechecked and guarded but has not been observed firing; the guard half
("never fires when a proposal exists or no schedule was parsed") is a 1-line invariant.

### F11 🐛 The schedule confirm-back line is hardcoded English

`conversation-author.ts` → `scheduleConfirmTail` emitted *"🕒 I've read the send time as Thursday, July 23,
2026 at 9:00 AM (Asia/Bangkok). Please confirm that's right — nothing is scheduled until you do."* directly
under an otherwise fully Indonesian reply. 7th recurrence of
`feedback_localize_user_facing_not_model_input`, and this one is load-bearing copy — it is the sentence the
user is being asked to act on.

### F9 🐛 Gmail has no pre-flight connection gate — the social path does

`connection-resolver.ts` has no notion of email/Gmail (no `gmail`/`needsEmail` reference anywhere in it).
Consequence, observed in order: 3 credits burned on `email_writer` → user asked to approve a send → node
**fails after approval** with `email_agent: send failed (gmail_not_connected)` rendered verbatim in the UI.

Three problems in one string: it is a raw internal identifier, it is English inside an Indonesian
conversation (6th recurrence of `feedback_localize_user_facing_not_model_input`), and it offers no
"Connect Gmail" action. Compare the social path, which parks at `needs_connection` *before* spending
anything and says "Connect Facebook, Instagram to publish".

### F10 🐛 maskEmail hides the identifying part of the address

`atria-tools.ts:58` keeps only `local[0]`. Every plus-addressed alias therefore collapses to the same
string: `auto.agent.solution+nghiep@` and `auto.agent.solution+lam@` both render `a***@gmail.com`. The
multi-match branch's own note says "show the masked emails so they can tell them apart" — for these leads
it is impossible. Also reads as a wrong pickup (user expected `n***` for Nghiep). Mask the middle, or keep
the `+tag`.

### O2 ⚠ BUG-4 empty-content flake hit the schedule-confirm turn again, and the retry did not clear it

`atria_brain_empty_content` → retry → `atria_brain_degraded reason=empty_content`, on the exact turn shape
BUG-4 names. The single re-call is not always enough; the turn was lost and cost 2 extra user turns to
recover (during which the brain called `execute_workflow` on a non-existent plan).

## Blocker for the remaining scripts

The test tenant holds **no credentials at all**. Every live cred (5 social + `google_drive_refresh_token`,
which is what Gmail send reads) sits on tenant `6455c2bd-67cc-48cb-ab77-5ead25747d02` in the same dev DB.
Until they are copied, scripts 6a/6b/9/10 stop at the Gmail failure and 3/11 stop at `needs_connection`.
User's preferred route is NOT copying creds but **minting a session cookie for their own superadmin
tenant** (`6455c2bd…`, their personal account, which already holds every credential) and running the live
half there. Not done yet — real emails would send from that account.

## Script status

| # | Script | Status |
|---|---|---|
| 1-3 | see previous report | ✅ / ⚠ |
| 4 | Schedule birthday email (ID) | ✅ scheduling proven (`scheduled`, resume 2026-07-23 02:00Z); F7 + F8 fixed; F9, F10, F11, O2 found; actual send blocked on creds |
| 5-11 | | pending |

## Unresolved

1. Gmail/social creds not on the test tenant (above) — a decision, not a bug.
2. Still undiagnosed from session 1: why runs 1/2 skipped the concept-selection gate while run 3 parked.
3. F8's (a) fix changes turn shape (a flow card would appear on the set_schedule turn) — that IS what the
   tool note specifies, and `scheduleConfirmTail` already exists to voice the confirm question, but it
   should be re-tested against script 3's flow before shipping.
