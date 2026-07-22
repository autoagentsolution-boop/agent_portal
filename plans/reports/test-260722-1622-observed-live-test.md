# Observed live test — 2026-07-22

Branch `pivot/video-content-farm` @ `3c1b8bf`. Headed Chromium, CDP :9333. Tenant
`ce155aa5-5f70-4e37-bc41-1f09328e223f` (`p6-demo-1784711472775@test.local`).

## Test-safety configuration

| Guard | State |
|---|---|
| `ENABLE_LIVE_SOCIAL_PUBLISH` | **false** — publisher runs, platform call simulated (`dryRun:true`) |
| Lead emails | repointed to `auto.agent.solution+nghiep@` / `+lam@gmail.com` (plus-addressing) |
| Scheduler + nurture crons | on |
| Wallet | 502,000 credits (trial 2000 + top-up) |

## Findings

### F1 🐛 On-image Vietnamese text is corrupted — unpublishable asset (Script 1)

`gemini-2.5-flash-image` mangled 4 words across 3 lines of on-image text.

| Requested | Rendered | Corruption |
|---|---|---|
| Làm ít **hơn**, **kiếm** nhiều **hơn**! | LÀM ÍT **HỜN**, **KIỂM** NHIỀU **HỜN**! | `ơ→ờ` ×2, `ế→ể` |
| AI tự động **hóa** 24/7 | AI tự động **hòa** 24/7 | tone flipped `ó→ò` |
| Khóa học cho nhà sáng **lập** | Khóa học cho nhà sáng **fập** | letter substituted `l→f` |

"nhà sáng fập" is not a word. Cost 69 credits — the most expensive node in the run,
2.4× the other three combined — for an asset that cannot ship.

**Root cause:** `src/imagegen/nano-banana.ts:21` hardcodes `const MODEL = 'gemini-2.5-flash-image'`.
No Pro option, no config seam. Confirms [[feedback_pro_banana_renders_vn_text]]: *Pro* Banana is the
variant that renders VN text; the product never uses it.

**Blast radius:** every image surface — `infographic`, `storyboard`, and **video keyframes**
(`agent-runners.ts:573/693/813` all pass the same model). Any non-ASCII script is suspect: VI, KO,
JA, TH, AR.

**Fix shape:** route to the Pro image model when on-image text contains non-ASCII, or drop on-image
text from the brief for non-Latin languages and compose it as an overlay.

### F2 🐛 English UI strings inside a Vietnamese conversation

- Out-of-credits toast: "You're out of credits — ask your admin to top up…"
- Publisher gate: "Connect Facebook, Instagram to publish — your draft is ready and waiting."

`web/src/components/OrchestratePanel.tsx:318-319` hardcodes **English on one line and Vietnamese on
the next** (`Chạy flow: ${...}`) in the same function. 5th recurrence of
[[feedback_localize_user_facing_not_model_input]].

### F3 🐛 Seed harness leaves the tenant unfundable

`verify-p6-seed-session.ts` never calls `ensureTrialGrant`, so a freshly seeded tenant sits at
balance 0 and every flow start 402s. Cost ~15 min of the test to diagnose.

### F4 🐛 No way back to a run's flow page — Edit/Refine become unreachable

After navigating away from the flow page, nothing routes back to it. Tried: resume card, workspace
menu → post "Open →", classic-UI toggle, board. The workspace-panel post view renders a reduced
workflow (steps + "Check connection & run") **without** `✎ Edit copy`, `✨ Refine with AI` or
`↻ Re-run this step`.

**Cause:** `web/src/components/atria-resume-work-cards.tsx:73` — a **run** card calls
`onResumeChat(r.chatSessionId)`; only a **saved-flow** card (line 95) calls `onOpenFlow(f.id)`. A run
that was executed but never "Saved as flow" therefore has no route home — even though
`App.tsx:335` already proves `openSavedFlow(runId)` accepts a plain run id.

Not a state issue: the same run showed those controls on the flow page while already in
`needs_connection`.

**Fix shape:** point the run resume card at `onOpenFlow(r.id)` (or offer both "Resume chat" and
"Open flow").

### F5 🐛 Refine/Edit copy leaves `keyMessage` stale — downstream nodes brief on old text

`web/src/components/concept-copy-editor.tsx:9` — `interface Copy { body; threads; x }`. Both
`✎ Edit copy` and `✨ Refine with AI` write only those three fields.

But `keyMessage` is **derived from body** at generation time
(`agent-runners.ts:149,177` — `keyMessage: copy.body.slice(0, 200)`) and is **never re-derived** on
refine. Observed live: after refining "drop the emojis, add 40% off ending Friday", Post body updated
correctly while Key message still read `🤖 Automated workflows mean few…`.

Not cosmetic — `agent-runners.ts:651` (`runStoryboard`) does
`parts.push(\`Key message: ${concept.keyMessage}\`)`, so storyboard frames and **video keyframes**
get briefed on the pre-refine message.

**Failure scenario:** refine copy to add "40% off, ends Friday" → re-run the storyboard/video step →
frames are generated from the old message and never mention the discount, while the published body
does.

**Fix shape:** re-derive `keyMessage` (and re-check `mainAngle`) inside the editCopy/refine handlers,
or stop persisting a derived snapshot and compute it at read time.

### O1 ⚠ Refine only partially honoured the instruction

"Make it much shorter — 3 lines max" produced ~8 lines. Emoji removal and the 40%/Friday addition
were both applied correctly. LLM-adherence observation, not a code defect — but if length control
matters, the refine prompt needs an explicit length constraint rather than free text.

### F6 🐛 Gate copy is wrong for every gate except publisher/video (Script 3)

`saved-flow-detail.tsx:362` (and `post-workflow-view.tsx:323`) render one catch-all string for any
`awaiting_approval` node that isn't `campaign_strategist` or `video`:

> "Paused before **concept writer** — an external action. Approve to proceed."

Wrong twice. (a) **"before"** — the concept *selection* gate parks AFTER the node completed
(`workflow-executor.ts:497` sets `completed`, then :505 parks), so concept is done, not pending.
(b) **"an external action"** — it is a content pick; nothing leaves the system. Observed the same
string on the **scheduler** gate, which also performs no external action.

**Fix shape:** switch on `agentGate(agentId)` — `'selection'` → "Pick a version to continue",
`'publish'` → the external-action copy, `'cost'` → the existing video copy.

### F7 🐛 Latin-script languages silently produce ENGLISH content (Script 3) — MAJOR

Request was 100% Indonesian ("Buat satu postingan Facebook … jadwalkan untuk besok jam 9 pagi").
Atria **replied in Indonesian**, then generated the post copy in **English**.

| run | request | `goal.slots.language` |
|---|---|---|
| 1 | Vietnamese | `vi` ✅ |
| 2 | English | `en` ✅ |
| 3 | **Indonesian** | **`en`** ❌ |

**Root cause:** `src/orchestration/master/detect-language.ts` → `contentLanguageFor()`.
`detectLanguage()` is **script-based**; Latin script with no distinctive diacritics returns `null`.
Its own comment says null means *"let the model mirror the user's message"* — but `contentLanguageFor`
does not consult the model, it falls back to hardcoded `'en'`.

The chat-reply path DOES ask the model (hence the Indonesian reply), so the two paths disagree and the
user sees a confident Indonesian reply attached to English marketing copy.

**Blast radius:** every Latin-script language — `id, ms, tl, fr, es, de, pt, it` — 8 of the 22 codes
the module's own `NAMES` map claims to support. Non-Latin (vi/th/ja/ko/zh/ru/ar/he/hi/el) is fine.

**Fix shape:** when `detectLanguage` returns null and there is no prior, take the language the LLM
analyzer already inferred for the reply instead of defaulting to `'en'`. The signal exists — it is
just not plumbed into the content path.

### Verified correct (no action)

- VI in → VI out on every conversational turn.
- Multi-turn flow edit: added Infographic, removed Strategy, rewired Publisher to `after n2, n3`.
- "tạo hình ảnh" → Infographic is correct — no `image` node exists in the 19-node registry.
- "chiến dịch marketing" → "📄 Single post" is correct — `STRONG_BATCH_RE` requires a calendar cue.
- Credit gate: 402 toast fires at ~2.5s. **An earlier "silent no-op" suspicion was RETRACTED** —
  the snapshot was taken a minute late, after the toast faded.
- Deferred connection gate (`wf_execute_deferred_connection_gate count:2`) — draft reviewable
  pre-connect (BUG-3 fix holding).
- Per-platform copy variants (body / Threads / X) all correctly in Vietnamese.
- Infographic visual brief + on-image text localized to VI; English model prompt not leaked to UI.

## Script status

| # | Script | Status |
|---|---|---|
| 1 | Multi-turn marketing + add/remove node (VI) | ✅ done — F1, F2 found |
| 2 | Edit & refine / regenerate (EN) | ✅ done — F4, F5 (**F5 FIXED**, `88a2282`), O1 |
| 3 | Schedule + manual post-inherits-setup (ID) | ⚠ partial — F6, F7 found; scheduling ✅, inherit half not reached |
| 4 | Schedule birthday email | pending — session stopped here (context) |
| 5 | Lead collector | pending |
| 6a | Nurture email (automatic) | pending |
| 6b | Document summarize + Security + email | pending |
| 7 | Analyze | pending |
| 8 | Memory | pending |
| 9 | Market research + send email | pending |
| 10 | Nurture + Strategist + Scheduler (anti-spam spacing) | pending |
| 11 | Video via video_script + video (24s) | pending |

## Resuming — read this first

The environment is LEFT RUNNING. Verify before restarting anything:

```
docker ps | grep mktagent-postgres-1      # :5433
curl -s localhost:7100/health             # {"ok":true,...}
curl -s localhost:9333/json/version       # headed Chromium, CDP
```

- **Tenant:** `ce155aa5-5f70-4e37-bc41-1f09328e223f` (`p6-demo-1784711472775@test.local`),
  ~501,900 credits, already signed in in the browser.
- **Drive the browser with** `agent-browser --cdp 9333 <cmd>`. **Always click via
  `eval(el.click())`** — `click <ref>` silently no-ops on this app (cost ~20 min to spot).
- **Backend log** is the background task output file; grep it rather than snapshot-walking the UI.
- If Chromium died: `bash plans/260714-0015-full-app-browser-test/launch-observed-browser.sh`,
  then re-run the lead-repoint + credit-grant steps below (the script mints a NEW tenant).

**Two setup steps the harness does NOT do** (both cost time to rediscover):
1. `ensureTrialGrant(ownerId)` — seeded tenants start at 0 credits and 402 on first run (F3).
2. Repoint lead emails to `auto.agent.solution+<name>@gmail.com` — the seed writes
   `nghiep.demo@gmail.com`, a real deliverable address. Lead PII is encrypted, so go through
   `createLead`, not SQL.

**Safety state to preserve:** `ENABLE_LIVE_SOCIAL_PUBLISH=false` in `MKTAgent/.env` (gitignored).
Publisher runs, platform call simulated. **Remove that line before expecting a real post.**
`sendGmailAs` has NO equivalent gate — email safety rests entirely on the +alias redirect.

## Next up: scripts 4-11

4 birthday email · 5 lead collector · 6a nurture auto · 6b doc summarize + security + email ·
7 analyze · 8 memory · 9 market research + email · 10 nurture + strategist + scheduler spacing ·
11 video (24s, `video_script` → `video`).

Language plan (spread, not repeated per script): VI · EN · **ID** · KO. **Re-test ID** on any
content-producing script to confirm F7's fix.

**Expect F1 to recur in script 11** — video keyframes go through the same hardcoded
`gemini-2.5-flash-image`, so non-ASCII on-frame text should corrupt identically. Capture it.

## Unresolved

1. Seeded tenant has **no connected platforms**, so the publisher can only park at
   `needs_connection`. Exercising the post-approval publish path (even simulated) needs tokens
   copied onto this tenant. Affects scripts 3 and 11.
2. Script 10's anti-spam spacing is day 0/3/6 — not observable in real time; must be verified by
   reading the computed next-touch date, not by watching a send.
3. **Why did runs 1 and 2 skip the concept selection gate?** `concept_writer` carries
   `gate: 'selection'` (`agent-registry.ts:135`) and `conceptGate` defaults true
   (`orchestration-router.ts:507`), yet runs 1/2 show `concept_writer: completed` with no park while
   run 3 parked. Same surface, same defaults; the only structural difference is run 3's `scheduler`
   node. Not diagnosed — do not assume the gate fires reliably.
4. `agent-browser --cdp <port> click <ref>` silently no-ops on this app; `eval(el.click())` works.
   Matches the existing playbook gotcha — cost ~20 min before it was spotted. Always eval-click.
