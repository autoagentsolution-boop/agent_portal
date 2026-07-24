# Observed test — Script 6b (doc summarize + Data Guard + email) · KO

Env restored this session: pg :5433 · BE :7100 · web **:5173** (2 zombie vite killed) · browser CDP :9333 ·
Gmail token refresh OK (254-char access) · logged in as user tenant `6455c2bd…` (superadmin, 1,982→1,967 cr).

## Result

| Item | Verdict |
|---|---|
| 🛡️ Data Guard (KO) | ✅ masked personal(김민준)/contact(email+phone)/financial(bank acct)/government_id(주민번호). Artifact `security_scan` confirms `[PERSONAL]/[CONTACT]/[FINANCIAL]/[GOVERNMENT_ID]` tokens. |
| 📝 Summarize (KO) | ✅ worked from masked copy, **zero PII leak** in the summary. |
| Cost | run = **15 credits** (Data Guard ≈9 + Summarize ≈6), $0.009, 4,406 tok. |
| 🔴 F15 email drop | Plan = 2 steps (security→summarize), `needsEmail=false`, `taskTargets=["summary"]`. Email dropped despite explicit KO request + verbatim recipient. |
| 🔴 F15b false promise | Turn-1 **prose** promised "요약하여 …이메일 주소(…)로 보내드리겠습니다" while the executable plan had NO email node and said "nothing is sent". Prose/plan divergence. |
| 🔴 F16 email follow-up err | Follow-up "email the summary to X" → generic **"Atria is having trouble and could not process that request."** Not yet root-caused (needs a BE log under our control). |
| O (not a bug) | contract amount 4억5천만원 not masked — commercial-sensitive, not GDPR PII; summary dropped it anyway → no leak. |

Screenshot: `plans/reports/s6b-plan-dropped-email.png`. Run id `f0d54e5f-…`, chat `e72ef643-…`.

## F15 root cause (definitive)

Two mutually-exclusive brain tools, both converging on `masterAgent.planFromGoal`:
- `propose_workflow` — marketing/email/video/research; owns `kind: email|marketing`, schedule, refine, lead resolution.
- `propose_task` — utility (summarize/translate/…); schema = `{capability, source_text, message_language}` **only — no send param**, and does NOT run email detection.

For "summarize AND email", the brain must pick ONE tool. It picks `propose_task` (salient verb) → email intent vanishes (no slot). The **prose** promised email because free-text isn't constrained by the chosen tool's schema.

**Planner also blocks composition** even if a goal carried both:
```
workflow-planner.ts:37   if (goal.taskTargets?.length) return goal.taskTargets   // short-circuits
workflow-planner.ts:45   if (o.needsEmail) return ['email_result']              // never reached
```
`targetsFromGoal` returns taskTargets and never reads `outputs.needsEmail` ("ignoring the marketing output flags"). So email drop is **2-layered**: tool can't express it + planner would ignore it.

Note: `email_writer` already accepts `summary` as OPTIONAL grounding (registry line 330 "summarize → email") → the executable graph SUPPORTS the chain; only the goal→planner path to trigger it is missing.

## DECISION — fix approach B, DEFERRED until whole test suite done

User (2026-07-24): fix = **B (full merge of propose_task + propose_workflow into one `propose` tool)** to eliminate the two-tools-overlap inconsistency at the root — **but implement ONLY after finishing all remaining test scripts.**

B sketch (for when we implement):
1. One `propose` tool: runs the requirement analyzer AND accepts a utility capability + source_text; captures utility taskTargets + marketing/email/send outputs in one goal.
2. Planner `targetsFromGoal`: **union** taskTargets with action targets (email_result/…) instead of short-circuit at line 37.
3. Fuse the delicate propose_workflow logic (kind, merge/refine, remove-node, schedule confirm, lead resolution, language) into the merged handler WITHOUT regressing — this is the risk; needs the existing verify-* suites (verify-master, verify-planner-golden, verify-email-node, verify-summarize-node) green.
4. Prose guard so Atria never promises a step the plan lacks.
5. Re-test F15 + F16 live, green, THEN done.

## Script 7 (Analyze) — ✅ PASS · JA

`get_workspace_data` → `workspaceMetrics` → real numbers, brain voices them in Japanese (perfect, no leak).
Cross-checked vs DB (all real, no hallucination):
- posts **7** = mkt_post posted(5)+partial(2) ✅ · leads **2** = mkt_lead 30d ✅ · usd **5.44** = sum(mkt_llm_usage.cost_usd) 30d ✅ · credits **8,696** = creditsFor(5.44) ✅ · reach 2,100 = LABELED estimate.

## Script 8 (Memory) — PARTIAL · TH · finding F17

- ✅ `recall_memory` works: a FRESH session correctly recalled previously-persisted facts (GreenLeaf brand, Atria brand — 2026-07-10 rows).
- 🔴 **F17** save_memory not fired: told Atria (TH) "remember our tone is friendly & eco-conscious"; it replied "รับทราบ…จะจำไว้" (I'll remember) but **0 rows persisted** (mkt_memory unchanged in 20 min) and a fresh session recalled the OLD/generic tone, not "eco-conscious". Persistence depends 100% on the brain electively calling `save_memory` (no per-turn extraction, no deterministic backstop) and it skipped it. Same family as F15b (prose promises an action the system never takes). Fix belongs with the F15 batch (deterministic recovery of an explicit remember-intent).

## Theme across F15b + F17
LLM free-text reply promises an action (email / remember) that no tool call backs. Codebase already uses deterministic recovery elsewhere (propose_task gap-log, rescueScheduleProposal) precisely because "the brain routinely skips" the call — email-send and memory-save lack that backstop.

## Script 9 (Market research + email) — FAIL · DE

- Language: German ✅ (F7 declared-language path works for a non-script-detectable European lang).
- 1st attempt: `web_search` (groundedSearch) errored → graceful German apology, no plan. **Transient** — `groundedSearch('…')` standalone SUCCEEDS (text 4196 chars, 5 cites, model `gemini-2.5-flash` + `google_search`). withRetry didn't clear the live spike.
- 🔴 **F18** raw model-scaffolding leak: retry rendered `tool_code\nprint(default_api.web_search(query='…'))\nthought\n<English CoT>…` VERBATIM in the chat bubble. **User confirmed this must not display.** Gemini emitted the tool call as a TEXT part (not a structured functionCall); the brain loop neither executes it nor strips it → (a) search never ran, turn dead-ended; (b) internal scaffolding + chain-of-thought leaked. Same robustness family as F16.
- Direct-content email (bypass research): Atria replied clean German prose "Sobald Sie dies genehmigen, werde ich die E-Mail versenden" but **rendered NO plan card / NO Approve button** — brain never called `propose_workflow`. Prose promise, no executable plan.

## 🔴 CONSOLIDATED: email-SEND leg never reached a plan card this session (4/4 entry paths)
| Entry | Outcome |
|---|---|
| 6b propose_task + email | F15 dropped, false prose promise |
| 6b follow-up "email the summary" | F16 "Atria is having trouble" |
| 9 research→email (DE) | F18 tool_code leak, turn died |
| 9 direct-content → email | prose "once you approve I'll send" but NO card |
Root = same family as F15/F17: the brain electively SKIPS the tool call (`propose_workflow(kind=email)`) and just narrates. No deterministic backstop for email-send. The B-merge + deterministic recovery should target this whole class. **A live Gmail SEND has NOT been achievable through the brain this session** — even though the Gmail token itself refreshes fine (verified 254-char access token).

## Script 11 (Video 24s) · VI

- 🔴 **F19** memory-bleed into scope: "make me ONE 24s video for GreenLeaf" mis-planned as a MULTI-PLATFORM CAMPAIGN (Ideation→Strategy→Campaign Strategist→calendar, publishes to FB/IG/Threads/LinkedIn/X), video node ABSENT. Recalling the established brand **GreenLeaf** pulled its old campaign scope + 5 platforms (2026-07-10 memory) over the single-video intent. Same family as the language memory-bleed the codebase already guards — here it's scope/platforms.
- Re-run with a NEUTRAL brand ("Nắng Sớm") + explicit "one video, not a campaign, don't publish" → plan CORRECT: **Concept Writer → Video Script → Video** (3 steps), VI reply confirms single video + no publish. Confirms F19 = memory-bleed, not a general video-routing bug.
- Video cost gate works: script rendered in VI (4 scenes, 24s, good VN copy + CTA), gate says "renders 4 keyframes and 24s of video — roughly $1.20 … Nothing generated yet." Approved → concept_writer ✅ video_script ✅ video **running** (Veo). 4 keyframes go through nano-banana → **watch for F1** (VN on-frame text corruption) on the keyframes.

### Script 11 video render — F1 CONFIRMED + F21

- Approved the real render. Veo + keyframes ran (llm_usage: video_script $0.007 + 3 keyframes nano-banana ~$0.117 + **3 Veo clips $0.2+$0.3+$0.4 = $0.90**, ≈$1.02 total). Then the FINAL assembly **failed**: `wf_node_run.error = "ffmpeg exited 3221225794"` = 0xC0000142 STATUS_DLL_INIT_FAILED.
- 🔴 **F21** (infra + product): ffmpeg is on PATH (Gyan 8.1.1, runs from CLI) but exits 0xC0000142 when spawned by the backend on this Windows box → the 3 Veo clips (`output/videos/*.mp4`) never get concatenated. **~$1.02 spent, no deliverable.** Product angle: money is spent on keyframes+Veo BEFORE the stitch can fail; a pre-flight ffmpeg check or partial-output recovery would avoid paying for nothing.
- 🔴 **F1 CONFIRMED** (VN on-frame text): keyframe 3 (`output/images/c330ebfc….png`) renders the brand as **"Nắng Sóm"** — correct is **"Nắng Sớm"**; the "ớ" (o+horn+acute) lost its horn → "ó". nano-banana (`gemini-2.5-flash-image`, hardcoded `nano-banana.ts:21`, no Pro option) can't render VN diacritics. Exactly the predicted recurrence. Keyframes 1-2 had no text overlay so only KF3 exposed it.

## Script 10 (Nurture + Strategist + Scheduler spacing) — FAIL · ES(→VI)

- Asked (Spanish) for a 1-week campaign, **4 posts scheduled spaced across different days** for Nắng Sớm.
- Language: reply came back in **Vietnamese**, not Spanish. Nuance/confound: the brand name "Nắng Sớm" carries VN diacritics, so `detectLanguage` likely caught VN and overrode the Spanish body. A mixed-script proper noun flips the whole reply language. (Not a clean "es ignored" case — my test introduced the confound; German in script 9 declared 'de' fine.)
- 🔴 Scope/scheduler MISS (clean, the point of script 10): plan card = a SINGLE immediate post (Ideation→Strategy→Concept Writer→Publisher, "One post, set up end to end"). **No scheduler node, no calendar, no spacing** — despite explicit "4 posts, scheduled, spaced across different days." The PROSE described the 4-post spaced calendar correctly → yet another prose/plan divergence (F15b/F17 family). Anti-spam scheduler-spacing was never planned.

## FINAL suite tally
6b: DataGuard ✅ Summarize ✅ / email **F15+F16** · 7 Analyze ✅ · 8 Memory ✅recall / **F17** save · 9 research+email **FAIL/F18** · 10 campaign **scope-miss** + lang-confound · 11 video **F19**(mem-bleed)+**F1**(confirmed)+**F21**(ffmpeg).

## Findings ranked (worst first) → all deferred to post-test fix
1. **Email-SEND unreachable via brain** (F15/F16 + 9/direct = 4/4 paths) — the flagship. Fix = merge B + deterministic recovery.
2. **Prose/plan (and prose/action) divergence** — F15b, F17, script-10 scope, direct-email. Atria narrates an action the plan/tool never performs. Cross-cutting; the merge + a "never promise what the plan lacks" guard.
3. **F18** raw tool_code/CoT leak + turn dead-end (Gemini text-emitted tool call).
4. **F19** memory-bleed: recalled brand drags its old campaign scope/platforms over a single-asset ask.
5. **F1** VN on-frame text corruption (nano-banana, no Pro option) — infographic + video keyframes.
6. **F17** memory save skipped on explicit "remember".
7. **F21** ffmpeg 0xC0000142 on Windows — infra; +product (pays before stitch).
8. Scheduler-spacing / multi-post calendar not planned from an explicit scheduled-multi-post ask.

## Cleanup owed (do when user says)
- `output/videos/*.mp4` (3 Veo clips ~$0.90) + `output/images/*.png` (3 keyframes) from the failed run — orphaned.
- Live-account leftovers from prior sessions: test lead `a3ad8bb8…`, nurture thread `65d1e23f…`, intake token. Plus test memories/chats created today (memory GreenLeaf untouched; today's chats e72ef643 etc.).
Language spread so far VI·EN·ID·ID·**KO(6b)**. Sends (9/10, + any publish) need USER approval clicks — harness blocks outward send/approve clicks; even "Approve & run" was blocked this session.

## Open questions
- F16: is the follow-up email error transient (BUG-4 empty_content class) or a real exception in the propose_task→email path? Needs a BE log under our control to root-cause.
