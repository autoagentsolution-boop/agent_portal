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
| 2 | Edit & refine / regenerate | next |
| 3 | Schedule + manual post-inherits-setup | pending |
| 4 | Schedule birthday email | pending |
| 5 | Lead collector | pending |
| 6a | Nurture email (automatic) | pending |
| 6b | Document summarize + Security + email | pending |
| 7 | Analyze | pending |
| 8 | Memory | pending |
| 9 | Market research + send email | pending |
| 10 | Nurture + Strategist + Scheduler (anti-spam spacing) | pending |
| 11 | Video via video_script + video (24s) | pending |

## Unresolved

1. Seeded tenant has **no connected platforms**, so the publisher can only park at
   `needs_connection`. Exercising the post-approval publish path (even simulated) needs tokens
   copied onto this tenant. Affects scripts 3 and 11.
2. Script 10's anti-spam spacing is day 0/3/6 — not observable in real time; must be verified by
   reading the computed next-touch date, not by watching a send.
