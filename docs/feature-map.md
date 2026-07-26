# Feature Map

Living record of features shipped and their real relationships in the app. Each commit appends a stub below; the model curates the relationships.

## Features & relationships

### Interface i18n — UI language separated from content language (`c13c6b6`, `aa6ed2b`, `20c17dc`, `ebd755e`)
The frontend gains a dependency-free i18n runtime (`web/src/i18n`, ~60 lines: `t()`, `LocaleProvider`, `useLocale`, English fallback, `{param}` interpolation, typed `MessageKey` so a wrong key is a build error). `User.uiLanguage` (nullable, follows the browser when null) governs the interface; `PATCH /auth/me` sets it against an en/vi/id/ko allow-list. The act-on tier (12 components — approve/connect/pay/retry/delete/schedule/publish + raw-error toasts) renders through en/vi/id/ko catalogs.
- **Relationship — this is the durable answer to [[content language mirrors the chat]] and the F13 lead-language fix (`c473868`), which were the SEVENTH one-off patch of the same defect class.** The audit (`plans/reports/audit-260722-1949-language-localization-gap.md`) found the mechanism, not the bug: content language is decided at ~6 backend sites and the interface had **no i18n at all** (≈830 literals). Those are two different systems; `uiLanguage` and `defaultLanguage`/`slots.language` must never share a field — conflating them is the bug in a new place.
- **The server stops authoring sentences the client can't reach.** `fail()` gains an optional `params` → `{ error: code, params }`; the client turns the code into words via `t-error.ts` (`err.<code>` keys, each with a remedy clause). This is the half a frontend-only i18n cannot touch — where `invalid_grant`/`gmail_not_connected` used to surface raw. Backward compatible: `error` stays a bare code string.
- **F11 fixed on the CONTENT side, not the catalog.** `scheduleConfirmTail` was vi/en only, so an Indonesian/Korean reply got the English tail appended. Now data-driven over the launch set — but authored in the REPLY's content language (`conversation-author.ts`), never `uiLanguage`, because it is streamed chat content no client catalog reaches.
- **Enforced so the eighth recurrence fails CI, not a user.** `verify-i18n.ts` (unit tier, 22/22 green) asserts param parity across locales, catalog validity, `uiLanguage` absent from `src/orchestration/**`, and a per-file literal allow-list (`i18n-migrated.json`) a migrated screen can never regress out of. The rule is in `.claude/rules/development-rules.md` with a pointer to the verify.
- **Deliberately staged:** decorative/chrome copy (~580 strings, phase 06) and the LLM translation pipeline (phase 04) are not built — the launch set ships en/vi/id/ko hand-authored for the act-on tier only. Plan: `plans/260722-1949-i18n-full-surface/`.

### Video renders from a script, not storyboard frames — `video_script` agent (`1492937`)
19th registry node. The video DAG becomes `content_concept → video_script → video`; storyboard leaves the video path and keeps its own job (detail frames + the carousel deliverable). `video_script` decides the shot list, per-shot motion, per-shot duration, spoken narration, a 3-second hook and a closing CTA. `runVideo` renders its own keyframes and animates each with that shot's motion for that shot's duration.
- **Relationship — this is the composability claim from [[the composable planner]] (`0295323`) actually being cashed in.** Adding a node was a registry entry + an artifact type + a `PIPELINE_ORDER` slot; the planner derived every edge from `requires`/`produces` with no planner logic written. It is also the extension path `docs/product/08` sanctioned — *add nodes to the registry*, not runtime agent spawning, which doc 07 rejected.
- **The old coupling was asserted in SEVEN places, not one.** Registry, `requirement-prompt`, `orchestration-mappers`, `goal-merge`, `deterministic-analyzer`, the dedicated verify script, and the golden snapshot. A missed site does not fail loudly — it silently plans and **bills** 3-6 storyboard images the video never consumes, so `verify-storyboard-video-dep` was inverted to assert storyboard is **absent** from a video-only plan. Absence assertions are the point here, not presence.
- **Inherits the cost gate unchanged, and that mattered to the design.** `video` keeps `requiresApproval: true, gate: 'cost'`; `video_script` generates no media and spends no media budget, so the human still stands in front of every dollar of Veo. This is why the script node was NOT given media generation despite the reviewability cost noted below.
- **Feeds `thinking-budget.ts` creative tier** (alongside `concept_writer`/`email_writer`) — both new planners scale their reasoning with `goal.qualityPref`, because the quality they decide is paid for downstream in image and Veo spend.
- **Known regression, deliberately accepted for now:** the gate previously let the user look at *already rendered* frames before approving Veo; now nothing is generated at that point, so approval is blind on visuals. Mitigated by the script review UI below; the real fix (one preview keyframe of shot 0) is decided but unbuilt — see `plans/260721-1343-video-length-and-quota-budget/`. Note its original justification ("a rejected script burns 4-6 of 10 daily requests") died with the retraction below — re-justify it on cost before building.
- ~~**Blocked from going further by provider quota, not by cost.** Gemini free tier is 3 req/min and 10/day…~~ **RETRACTED 2026-07-21 — this was free-tier documentation, never measured.** The account is on a paid **prepaid** tier. `mkt_llm_usage` for 2026-07-21: **45 Veo calls, 24 of them inside one hour, 426 calls total**, and no daily request wall anywhere in the ledger. The binding constraint is the **prepaid balance** ($39.54 lifetime, $17.91 of it in that single day), which is why the 48s ceiling below became a cost decision and could be lifted. The silent-truncation defect it described was real and is fixed — see below.

### A terminal provider stop fails loud instead of truncating the video (`1d9b656`, `66c6ac5`)
`lib/quota-error.ts` classifies a Gemini `429 RESOURCE_EXHAUSTED` into **per-minute** (transient, back off), **daily** (spent quota) and **billing** (prepaid credits depleted). Only the first is retried.
- **Relationship — it exists because `runVideo`'s per-shot catch was too broad.** That catch is correct for the flaky "200 with no image" case it was written for (~1/3 of image calls), but a provider stop hits *every* remaining shot, so it turned one 429 into `degraded: true` and a silently truncated video after a ~10 minute wait. `degraded` is now reserved for genuine flakiness; a terminal stop throws, naming the model, N-of-M shots rendered, and that the finished ones are cached.
- **Resume is free by design, not luck.** `veo.ts` keys its cache on (prompt + duration + reference-image bytes) and `nano-banana.ts` on (prompt + mode + ref path) — content-hash filesystem caches on the persisted `mktagent-media` volume — so a re-run after a stop calls the provider only for the missing shots.
- **The `billing` case is the one this deployment actually hits, and it collides with the rate-limit envelope.** Prepaid depletion ships as the *same* `429 RESOURCE_EXHAUSTED` with the message `"Your prepayment credits are depleted"` and no quota metadata, so without an explicit message match it would classify as per-minute and truncate exactly as before. The match is deliberately narrow (`deplet`, `insufficient credit|balance|funds`) and **not** on the word "billing", which appears in the ordinary rate-limit copy.
- **Operational blast radius worth knowing:** at $0 balance Google stops **every API key on the billing account** — chat, copygen, research, not just video. No code prevents that; auto-reload in AI Studio is the only defence.

### Video runtime is a user choice; `videoTarget` demoted to rhythm + aspect (`8dac91f`)
`goal.slots.videoLengthSec` (12–120s) sets the length. A `Video runtime:` directive states the target and the derived shot range `ceil(T/8)..floor(T/4)` on every call; the contract defers to it instead of hardcoding "3 to 6 shots".
- **Relationship — it corrects a claim `video_script` was making but not keeping.** `videoTarget` read like a length control; a controlled live test (same product, only the slot varied) returned tiktok 24s · reels 24s · youtube 26s · feed 24s. It steers rhythm and aspect only, and its hint strings lost all duration language so a weaker instruction no longer competes with the explicit one.
- **Unblocked by the retraction above.** The 3–6 shot × 8s = 48s ceiling was justified as quota protection; once that premise fell it became a pure cost bound, so 120s (~$6.60) is now allowed. Defaults are unchanged: 24s still derives 3–6 shots.
- **Enforced on the upper bound only, and the trim direction is load-bearing.** Each extra shot is a real keyframe plus a real Veo clip, so an overshoot bills for a video nobody approved; trimming drops from the **middle** so shot 0 (hook) and the original last shot (CTA) survive. Under-delivery is left alone — it costs less than asked and the gate shows the true runtime.
- **Reachability was the real gap.** No UI edits goal slots, so `analyzeDeterministic.parseVideoLength` (EN + VI, seconds or minutes) is how a length is expressed. Gated on video intent so "reply within 5 minutes" cannot set a runtime, and kept separate from `parseLength`, which is copy length in words.

### The http verify tier is deterministic, free and green — 85/85 (`ffa9b28`)
The runner boots the http-tier server with `GEMINI_API_KEY` cleared and spawns its scripts with the same env, so `POST /orchestration/runs` falls back to the deterministic planner instead of the live Atria brain.
- **Relationship — it exists because the Atria brain became the front door to run creation.** Every message now routes through a live model function-calling loop that decides plan-vs-converse, so scripts asserting deterministic planner/router invariants were really asserting the model's mood: the same message planned on one run and was answered on the next. Three scripts failed intermittently and each run spent real money.
- **It exposed two real bugs the LLM path had been masking.** `legacyFallback` called `masterAgent.handle` (analyzes in isolation) instead of `refine`, so the no-key path forgot every gathered slot on a follow-up turn. And bare `short` sat in the video keyword list, so *"Short punchy Vietnamese Instagram post"* planned a **Veo video for a text post** — an adjective read as the YouTube format, billable.
- **Three assertions were stale, not broken — each pinned behaviour deliberately reversed later:** the form-token contract (now liveness-verified on save, fails closed), the richness gate (removed as the "6 rounds to plan" bug), and the connection gate (moved to publish time by gate-after-content). Distinguishing "the product regressed" from "the test froze an old contract" was the bulk of the work; the fixes went in opposite directions accordingly.
- **Coverage loss is surfaced, not silent.** Sections that need a live model skip themselves, and the runner lifts those lines into its summary — a passing script's output is never printed, so a silent skip would read as full coverage. `verify-api`'s live-execution section is documented as *unreachable in any stable configuration* (keyless: planning solid, execution impossible; keyed: execution possible, planning flakes), with the db-tier stubbed executor tests named as what actually covers it.

### Provider-spend panel, super-admin only (`37ca544`)
`GET /admin/provider-spend` + a panel at `/superadminatria101`: rolling 24h/7d/30d/lifetime, a 14-day series, and 30-day by-surface/by-model slices off the existing `mkt_llm_usage` ledger.
- **Relationship — it is the scoped-down survivor of "pre-flight quota budget".** That was impossible twice over: no daily request wall exists on this account, and **no API exposes the Gemini prepaid balance** (Cloud Billing does not have it; AI Studio's Usage-and-Limits page is the only place it lives). So the panel reports spend and burn rate and **claims no balance** — a test asserts the payload has no `balance`/`remaining`/`runway` field so an inferred one cannot creep in later.
- **Reuses the ledger that already backs cost accounting** — no new table, no GCP credentials, nothing external to fail. `costUsd` is the price-table estimate recorded at call time, labelled as such in the UI rather than presented as billing truth.
- **Windows are rolling, not calendar days**, so they mean the same thing regardless of server timezone or which timezone Google closes its billing day in. Super-admin only by decision: tenants see their own credit cost, never the platform's provider bill.

### Infographic became a real planner (`1492937`)
The node had **no LLM call at all** — a fixed sentence with slots, identical for every product, with `no text overlay` hardcoded into a node named "infographic". Its registry `decisionFramework` described reasoning that no code performed. It now plans layout, on-image text and aspect ratio through the same prompt-as-data path `storyboard` uses.
- **Relationship — it consumes the biggest single line of spend.** The context audit measured `infographic` at 43% of all spend ($9.27 of $21.63 over 30 days, $0.040/image). Adding ~500 planning tokens (~$0.0002) to stop that $0.040 image being generic is the cheapest quality lever in the system.
- **Deliberately did NOT change the deliverable:** still exactly one image, `assetType: 'image'`, publish validation untouched. Letting it emit a multi-panel set would have touched the image↔carousel asset type and the publisher's exactly-1-asset rule — a much larger blast radius for a quality change.
- **Broke five verify scripts at once and that was the useful signal:** a node that previously made no LLM call now does, so every DRY-RUN stub returning a generic strategy brief failed the new contract. The stub was copy-pasted in 5 files; it is now `orchestration/testing/stub-llm-json.ts`.

### User-facing text is localized; model input stays English (`1492937`)
Image and video models perform best in English, so `imagePrompt`/`motion` are English by design — but they were being **rendered to users** next to localized narration, so a shot card read half Vietnamese and half English. `artifact-format.ts` had been showing infographic's English `Image prompt` to users well before this change.
- **Relationship — fourth recurrence of the same bug class**, after [[content language mirrors the chat]] (`bc2c60d`) and the reply-language pin work. Those fixed *which* language; this fixes *which fields are user-facing at all*, which is a different axis and is why the earlier fixes did not prevent it.
- **The fix is a contract split the codebase already had and had not generalized:** infographic's `visualBrief` (run language) vs `imagePrompt` (English). `video_script` shots gained `brief`. No per-language code — `buildAgentPrompt` pins the resolved run language, verified live in Vietnamese, Indonesian and Korean.
- **Pinned by asserting on contract TEXT, not behaviour** (`verify-video-script`): every contract carrying both kinds of field must contain `ENGLISH` and `LANGUAGE specified above`. A behavioural test would need a live model; this catches the regression at the source.

### Video cost gate shows what is being approved (`1492937`)
`web/src/components/video-script-review.tsx` — shots, durations, narration, hook, CTA, estimated Veo spend.
- **Relationship — it exists because the DAG change invalidated the old gate copy.** "Review the frames above" was true when video rendered from already-generated storyboard frames. With `video_script` upstream, nothing is generated at the gate, so the most expensive step in the system was being approved against an empty screen.
- **Four renderers needed the change, not one** — both gate blocks (`post-workflow-view`, `saved-flow-detail`), a separate `statusHint` string, and `artifact-format.ts` (no `video_script` case → raw JSON fallback). Found by driving the real UI, not by grep: the first search for the shared gate sentence surfaced only two of the four.

### One credit scale + "re-runs are on us" declared as policy (`d931ef1`, `7c399e7`)
Credits now derive from real USD on EVERY surface — Usage, Impact, plan-tier quotes, per-run displays — the same basis `workflow-run-repo.runCredits` debits. Previously each surface used token passthrough while the wallet billed from USD, so the number a user saw and the number they were charged were different scales (token passthrough priced every token at the flash OUTPUT rate $2.50/1M against a measured actual of $1.40–$2.01/1M).
- **Relationship — this closes the loop opened by [[the credit double-count fix]] (`33d805b`).** That fix made the *debit* correct; this makes every *display* agree with it. `cost/spend-split.ts` is the single definition both Usage and Impact render, so the two pages cannot disagree about the same run.
- **Uncovered a second, opposite billing error while building it:** the wallet debits `wf_node_run.cost_usd` (a node's LATEST cost, overwritten on re-run) while `mkt_llm_usage` appends per call — the two diverged 4.5× across tenants. 205 real image generations against ~6 infographic node runs meant re-generation was already free in practice.
- **Resolved as declared policy, not a fix (owner decision, option (c)):** re-runs are absorbed for the early-adopter period, so users can iterate until output is right. `resetNodes` carries a **DO-NOT-FIX** block so nobody "corrects" the columns and silently re-prices the product; `absorbed.reruns` reports what it costs us; the Usage page sells it as a benefit. **Trigger to switch to accumulation (option (b)): tenant-count growth** — absorbing every retry is goodwill at small scale and an unbounded cost at large scale (~$0.04/image, no ceiling).
- **Reconciliation is structural:** `charged = nodesNotFailed + refine`, `absorbed = nodesFailed + (runAttached − allNodes) + offRun`; the node basis cancels, so the total always equals `mkt_llm_usage` exactly and the split only reallocates. Live: $3.4410 + $1.9516 = $5.3926 = real spend.
- **Feeds the 402 credit gate + top-nav balance pill** (both read the debited balance) and the autonomy grant's upfront-cost quote (`cost/plan-estimate.ts`, now also USD-based — fallback token estimates for no-history agents are priced at $2.00/1M so a fresh tenant isn't quoted free).

### Atria degraded-turn honesty (`d931ef1`)
When the brain can't answer (Gemini 5xx, or the known empty-`""`-content STOP), the reply now names the fault as ours and gives a real retry horizon — *"Atria is having trouble… try again in a few minutes"* — instead of "could you try again in a moment?", which read as though the user's message was at fault and invited an instant retry into the same failure window.
- **Relationship — `degraded: true` on the turn is the seam that makes the failure countable.** The router logs `atria_reply_degraded` at warn instead of `atria_reply` at info. Previously "Atria replied" and "Atria could not reply" were indistinguishable at the API layer, which is exactly why the `atria_brain_degraded` flakiness stayed invisible until `verify-campaign-reuse-http` caught it (1 pass / 2 fail over 3 runs).
- **Known-unfixed underneath it:** on a degraded refine the deterministic fallback FORKS a new run instead of refining in place — the user-visible "Atria lost my context and made a new flow" symptom, same class as `project_atria_campaign_flow_confusion_fix_260713`. Documented in doc 09 §3.5; the durable fix is multi-LLM / local-LLM fallback.

### Inbound rate limits + security headers (`08a1972`)
First inbound rate limiting in the app — the only limiter before this was OUTBOUND (`connectors/runtime/rate-limit-manager`, spacing publishes to avoid a platform anti-spam ban). `/auth` 10 req/min per IP; `/atria` `/agent` `/orchestration` `/voice` 20 req/min per TENANT.
- **Relationship — it backstops the credit wallet, which caps amount but not rate.** The 402 pre-flight gate stops a tenant at 0 balance; nothing stopped them reaching 0 at machine speed. Ties to the failed-run-is-free rule (`workflow-executor.ts:119`): a burst of failing runs costs us Gemini tokens and bills the tenant nothing, so rate is our exposure, not theirs.
- **Mounted AFTER `requireAuth`** on the LLM routes so the key is the tenant, not the IP — several users behind one office NAT share an IP, and the resource being protected is per-tenant spend.
- **GETs exempt, and the suite proved why:** the first run under this limiter produced 249 trips, 236 on one `GET /runs/:id` — the run-status poll the UI uses while a flow executes. A real user would have been 429'd out of watching a flow they had already paid for. Writes enqueue LLM work; reads do not. This is the seam to remember if a read-side ceiling is ever added — it must be a separate, looser limiter.
- **Helmet** ships default headers with no CSP (this process is a JSON API + static media; the SPA is served from `UI_BASE_URL`, so a CSP here governs the wrong surface) and `crossOriginResourcePolicy: cross-origin`, without which every `/media/images` and `/media/videos` asset in the UI breaks.

### Verify runner — one command for the 83 verify scripts (`6b18b1f`, `3aa623c`)
Nothing ran the verify scripts together and `package.json` had no `test` script, so the project's "run tests before push" rule was unenforceable. `npm run verify` sequences the 68 local ones; `verify:http` boots a server and runs the other 14.
- **Relationship — it is the gate everything else in this batch was validated through**, and the prerequisite for splitting `agent-runners.ts` (1,237 lines, highest-churn file in the system) without silent breakage.
- **Found two pre-existing failures nobody could have seen:** `verify-registry` had 4 red checks because its `ASSET_TYPES` allowlist went stale when `text` shipped with the `asset_type_text` migration — now `Record<AssetType, true>`, exhaustive by construction, so adding an enum member breaks tsc until it is listed. `verify-post-from-agent` expected `assetType: 'image'`, an expectation predating Fix D (`413fef0`).
- **Excludes `verify-image-live`** (one real Nano Banana call, ~$0.06, no guard) unless `--include-costly`, and prints what it skipped so a green run never implies coverage it did not have.

### Credit billing corrected — runs bill from real USD (`33d805b`)
Fixes a double-count that over-debited every LLM node **2.4–2.8×**. `runCredits` (`db/repos/workflow-run-repo.ts`) summed `creditsFromTokens(tokens) + creditsFromUsd(costUsd)`, but `wf_node_run.cost_usd` is *derived from* those same tokens (`node-cost.ts costFromUsage`) **and** carries media USD, blended into one column by `sumCost` — so an LLM call was billed once by token count and again by the USD it produced. Now bills from `costUsd` alone: already prices prompt/cached/output/thinking each at its own per-model rate, already includes media, and cannot overlap with itself.
- **Relationship — this is the wallet's money path, not a display path.** It feeds `credit-repo.reconcileRunDebit`, which the executor calls at EVERY stop point (park / fail / complete, `workflow-executor.ts`), so it governs the balance that the 402 pre-flight gate and the top-nav credit pill read. The autonomy grant's upfront-cost quote (`cost/plan-estimate.ts`) is a *separate* estimate path and still uses token passthrough.
- **Divergence introduced, deliberately:** display surfaces (Usage dashboard `cost/llm-usage.ts`, Impact `impact/impact-metrics.ts`, plan-tier cards) still present the token-passthrough scale, so a displayed credit figure no longer matches the debit exactly. Those two were already CORRECT in intent — they add `creditsFromUsd` over **tokenless** rows only (`totalTokens=0` ⇒ pure media), a discriminator that cannot work in `wf_node_run` because a storyboard/video node legitimately holds both. Aligning display to the money scale is a separate change.
- **Secondary error also removed:** `TOKENS_PER_CREDIT` priced every token at the flash OUTPUT rate ($2.50/1M); measured actual is $1.40–$2.01/1M, so prompt-heavy runs were over-charged even before the double-count.
- **Blast radius:** no ledger migration. Every debit ever written landed on one throwaway test tenant (114 charged vs 52 correct); both real accounts hold untouched 2,000-credit trials. Guarded by `verify-credit-wallet` (two fixtures corrected — one had asserted the double-counting formula itself), `verify-credits`, `verify-llm-usage`, `verify-impact`.

### Multi-channel nurture nodes — DM / greeting / comment-capture (DRY-RUN scaffold, `d789bfd`)
Extends nurture beyond email with three composable node areas, all built as REAL code but fail-closed to **DRY-RUN** (no live credentials exist; a real send needs an explicit token + an off-by-default `ENABLE_LIVE_*` flag).
- **DM node** (`src/messaging/`): `dm_writer`→`dm_agent` pair **mirrors the email node, NOT the publisher** — `requiresConnection:false` with connectivity checked inside the runner, because messaging credentials aren't `SocialPlatform` tokens. One pair fans to whatsapp/telegram/zalo via an adapter registry (`sendDm`); `isLiveDmSend(channel,hasToken)` is the DRY-RUN guard. New `MessagingChannel` enum (SEPARATE from `SocialPlatform`) + `DmContact`/`DmMessage` (phone/handle encrypted like `Lead` PII). Opt-in refusal is a hard gate. Telegram `/start` webhook.
- **Greeting node**: `greeting_writer`→`greeting_agent` **reuses the existing social adapters + `invokeAction`** (kill-switch/idempotency via the same `external_action_audit_log` the publisher uses — no new table). Adds ADDITIVE `SocialAdapter.mention?/reply?` per each platform's real API limit (X reply live / mention pre-check-degrade; Threads both; FB mention-tag only; IG unsupported). Central DRY-RUN gate `ENABLE_LIVE_GREETING_SEND`.
- **Comment-capture hardening**: routes a Meta webhook (`meta-webhook.ts`, `X-Hub-Signature-256` verified, raw-body-safe) into the SAME `captureLead` chokepoint the 30-min poller uses (webhook+poller dedupe to one). `Lead.email` now nullable + `platform`/`platformUserId`/`platformHandle` → **handle-only leads** = the bridge that makes captured commenters valid nurture/DM/greeting targets. X gated behind `ENABLE_X_LEAD_CAPTURE` (free tier = clean no-op); LinkedIn degrades gracefully.
- **Relationship:** all three plug into the shipped generic scheduler node (`TERMINAL_ACTIONS`) for timed nurture, and target the leads produced by comment-capture. Node wiring follows the same recipe as email/summarize/security (agent-types + workflow-plan enum + registry + runners + artifact-schemas + planner splice). Guarded by `verify-dm-node`, `verify-greeting-node`, `verify-comment-capture` (all DRY, 0 live calls).

### Lead-nurture agent — two-way, human-gated (`e4e8f5c`)
Turns captured leads from dead rows into an active email relationship: a proactive template drip AND reactive reply handling, with **human approval before EVERY send** (fail-closed). All flags default OFF.
- **Reuses the validated send path** `email_writer→scheduler→email_agent` — each nurture touch/reply IS one such run; the scheduler park gate IS the "approve each touch." NEW work = state + reply-ingestion + a light brain.
- **Drip state machine** (`src/nurture/`): `LeadNurtureThread`/`NurtureTouch`, sequence day 0/3/6 (`buildSequence`), atomic-claim driver cron; `advanceOneTouch` polls the parked run's `email_result` to advance. Enroll toggle + `User.nurture*` settings.
- **Reply loop:** adds `gmail.readonly` scope (users re-consent); `sendGmailAs` now threads (In-Reply-To/References/threadId) + returns ids; `InboundReply` (body encrypted); poller mirrors `comment-poller`.
- **Nurture brain** (`nurture-brain.ts`): a Gemini function-calling loop mirroring `atria-brain` — classify reply → draft → set state → escalate; **budget-capped** (reuses the P6 thinking-budget policy), product-grounded, fail-closed to escalate on unverifiable price/promise, prompt-injection-hardened (reply = DATA). Opt-out is deterministic (regex before the LLM) + GLOBAL (`NurtureSuppression` checked at enroll + email_agent pre-send + the legacy email panel).
- **Approval UX:** `nurture-router.ts` + Nurture Inbox (Command-Center `surface:'nurture'`) — approve/edit(`to` never editable)/reject; guardrails (daily-cap, signed `List-Unsubscribe`). Approve calls `runWorkflow({approveNodeId})` directly (NOT the HTTP approve-node route, whose scheduler branch rejects now-instants).
- **Relationship:** consumes leads from the lead-collector (incl. the new handle-only leads once they have an email); every send rides the same approval gate + credit-debit path as marketing flows; guarded by `verify-nurture-drip`/`-reply-ingestion`/`-brain`/`-e2e` (every send traces to an approval, 0 real sends).
- **Speaks the LEAD's language (`c473868`).** Live-observed defect: an Indonesian lead received a Vietnamese first touch. `buildTouchGoal` sets recipient/angle/stage but never `slots.language`, so `resolveRunLanguage` fell through to `user.defaultLanguage` — every lead was nurtured in the owner's language regardless of what they wrote in. `runEmailWriter` now resolves a **counterparty** language from the counterparty: explicit goal language → the lead's message when its script is unambiguous → *mirror the quoted message* for Latin script (no code separates `id` from `en`) → owner default only when there is no lead. **Touches:** the same `email_writer` node the one-off Email Agent and birthday/chat emails use, so a chat-derived language still wins there (script-4 behaviour preserved). **Guarded by:** `verify-nurture-email-from-chat` (+5, all failing pre-fix). Sibling gaps left open deliberately: `dm-runners` has no counterparty context to mirror, and the task path (`orchestration-router.ts:401`) still defaults Latin to `'en'` — both tracked in the i18n plan.

### Gate-after-content + Data Guard chunking + recipient-carry (bug batch, `9f915fa`)
Five correctness/UX fixes from the observed browser test.
- **Gate-after-content (BUG-3):** the connection gate no longer parks the whole DAG at `needs_connection` before generating anything — `executePlannedRun`/`test-run` now DEFER the pre-gate when the plan produces a reviewable draft (any node not `requiresConnection` → concept parks at the selection gate), and the executor RE-GATES connection at the publisher boundary (parks `needs_connection` instead of letting `runPublisher` throw). `respondRun` recomputes `requiredActions` so the connect prompt still surfaces. **Un-connected tenants can now review a draft pre-connect** — the message/behavior finally agree.
- **Data Guard full-document coverage (>40k):** `runSecurity` scans the WHOLE document in windows (fail-closed per window) and concatenates masked output — no tail silently dropped; `runSummarize` map-reduces when the masked text exceeds one window. Extends the shipped Data Guard node, not a rework.
- **Recipient-carry (S9):** the brain seeds `resolvedLead` from the prior turn's goal so it stops re-asking "who to?" across turns.
- **UI:** calendar slot fields wrap instead of truncating; the document-attach control now appears on the landing view too (reusing the existing handler).

### Credit wallet + super-admin grant console (`6c753be`)
Turns "credits" from a spend-DISPLAY into a real **balance/wallet**: a tenant has a balance, a super-admin grants credits, and flow execution is blocked when the balance hits zero. Payments still deferred. New-tenant trial = 2000 credits.
- **Ledger-as-truth:** new `mkt_credit_ledger` (`db/repos/credit-repo.ts`) — balance = SUM(delta), kinds trial/grant/debit/adjust. **Reuses the existing credit math** (`cost/credits.ts` `creditsFromTokens`/`creditsFromUsd`) unchanged — the wallet is a NEW layer ON TOP of the display anchor, not a rework. Idempotency: `@@unique([runId,kind])` = exactly one debit per run (grant/trial rows use `runId=null`, NULL-distinct); the trial is race-hardened with a tx-scoped `pg_advisory_xact_lock`.
- **Debit seam:** `runCredits()` (`db/repos/workflow-run-repo.ts`) aggregates a run's node-run tokens+media → `debitRun` at the executor's TRUE terminal completion (`executor/workflow-executor.ts`, after `setRunStatus('completed')`). Best-effort: a wallet failure never fails an already-completed run. The concept-gate early-return (run→planned) correctly does NOT debit. Chat/brain turns never debit — only the flow executor.
- **Gate (depends on the balance):** `executePlannedRun` + `/runs/:id/test-run` + the brain's `execute_workflow` "run it" path (`api/orchestration-router.ts`) return **402 `insufficient_credits`** at balance ≤0, ORDERED before the existing connection gate (§11.6) — a broke tenant is told to top up rather than sent to connect an account. `POST /orchestration/runs` conversational turns are never gated (loss-leader).
- **Identity echo:** `GET /auth/me` (`api/auth-router.ts`) now returns `credits`(=balance) + `isSuperAdmin` (new `User.isSuperAdmin` flag). Top-nav pill flipped from cumulative-spend (`GET /orchestration/usage`) → remaining balance (`web/App.tsx` `loadCredits`→`api.me()`); Usage page adds a balance line; **logout** button wired (`top-nav.tsx`→`useAuth.logout`→existing `POST /auth/logout`).
- **Super-admin console:** `requireSuperAdmin` (`api/middleware-superadmin.ts`) → **404** for non-admins (surface hidden). `api/admin-router.ts` mounts `/admin/tenants`, `/admin/grant`, `/admin/capability-requests` behind `requireAuth→requireSuperAdmin`. Capability backlog **REUSES the capability-gap mechanism** (`roadmap-demand-repo.listAllCapabilityRequests` over `mkt_roadmap_demand action='requested'` — the same rows the brain's `flag_capability_gap` writes) so the same super-admin who grants credits sees what to build next. `SuperAdminPage.tsx` at the hidden `/superadminatria101` route (URL-detected in App.tsx, never in nav).
- **Bootstrap:** `scripts/set-superadmin.ts <email>` sets the flag (run for auto.agent.solution@gmail.com).
- **Guarded by:** `verify-credit-wallet` (16/16, incl. concurrent-trial race) + `verify-credit-gating-and-admin-http` (9/9, live server + real auth/middleware, stops at the connection gate so no LLM/publish spend).

### Command Center: 2-tier grouped agent constellation (`93d3cdd`)
The flat ~17-node ring was cluttered; now Atria → group → agent renders as a collapsible hierarchy, default collapsed to 5 group nodes.
- **Taxonomy (display metadata ONLY):** re-split `agent-groups.ts` from 3 groups (the old "Action" held 8) into 5 phase-based groups — 🧠 Intelligence(4), 🎨 Creative(5), 📢 Delivery(2), 📊 Insight & Growth(4), ⚙️ Core(2: scheduler+summarize). Each runnable agent + vision agent reassigned. **Zero flow impact:** node selection keys on `produces`/`requires` (C1) and the thinking-budget policy (P6) keys on `agentId` — neither reads `group`, so golden 23/23 unaffected.
- **CC render (`command-center-page.tsx`):** default shows only the 5 group nodes (emoji + count) ringing Atria; clicking one expands its members fanned around THAT group node (new `groupGeo`/`memberGeo`); one open at a time; clicking Atria collapses. Reuses the existing energy-link/flow-dot system on both tiers (new `cc-flow-sub` dot for group→member) and the agent panel (`openAgent`) for member clicks. Consumes `GET /orchestration/agents` (`groups` + per-agent `group`), unchanged contract.

### Composable planner — backward-chaining selection (C1, `0295323`)
The planner selects agent nodes by **backward-chaining from requested output artifacts** instead of a marketing if-ladder.
- **Depends on:** the agent registry's `produces`/`requires` graph (`registry/agent-registry.ts`); a new single-producer reverse index (`master/artifact-graph.ts`).
- **How:** `targetsFromGoal` (the ONLY reader of `GoalSpec.outputs.*` flags) → `selectByTargets` (closes over producers/requires, returns canonical `PIPELINE_ORDER`).
- **Consumed by (unchanged behavior):** `master/master-agent.planFromGoal` (← router `POST /orchestration/runs`, `atria-tools.propose_workflow`), `master/plan-tiers.buildPlanTiers` (economy/balanced/full), `master/campaign-materializer` (per calendar slot). Node ORDER preserved so tier-card dedup stays stable.
- **Guarded by:** `verify-planner-golden` (23 cases incl. tiers + materializer). Publish-only still errors via flag-based `isPublishOnly`. Scheduler splice untouched.
- **Unlocks:** a scheduled email composes `email_writer → scheduler → email_agent` via artifact chaining — no `needsEmail` special-case; selection is now marketing-agnostic.

### Capability-gap handling — Atria honestly flags what it can't do (Phase 02, this commit)
When the user asks for a capability **no agent node produces**, Atria does not fake it or bend it into a marketing plan — it flags the gap as demand and tells the user honestly.
- **Depends on / REUSES (not a new table):** the existing `RoadmapDemand` mechanism (`mkt_roadmap_demand`, `db/repos/roadmap-demand-repo.ts`, `registry/roadmap-agents.ts` pitches, `registry/vision-agents.ts` surfaces). Extended with a nullable `spec Json?` column + `action: 'requested'`.
- **New:** brain tool `flag_capability_gap` (`atria/atria-tools.ts` + `prompts/atria-brain-prompt.ts`) → `recordCapabilityGap` (dedup via `wasRequested`) → `mkt_roadmap_demand` row with a drop-in spec (produces/requires/gate/example). Reply-only turn — sets NO workflow proposal.
- **Surfaced by:** `GET /atria/roadmap-demand` (owner-auth DEV backlog), alongside `/atria/roadmap` + `/atria/suggestions`.
- **Complements C1:** C1 composes EXISTING nodes; this is the honest fallback when NONE produces the needed artifact. The `spec` maps 1:1 to a registry `AgentDefinition`, so a dev scaffolds the node (registry + runner) with no planner change.
- **Guarded by:** `verify-capability-gap` (repo round-trip + dedup + brain dispatch); `verify-atria-suggestions` confirms the pitched/accepted path is unregressed.

### `summarize` — first non-marketing capability node, reachable + composable (Phase 05, this commit)
Proves the composable-agent thesis end-to-end: a real capability drops in with **only a registry entry + a runner**, is reachable from chat, composes with other nodes, and runs — with the marketing path untouched.
- **The node:** `registry/agent-registry.ts` (`summarize`: produces `summary`, requires `[]` — reads source from the goal like `email_writer`) + `executor/agent-runners.ts` `runSummarize` (Gemini → `{summary, bullets}`) + `schemas/artifact-schemas.ts` `summary` type. **No planner change** — this is the whole point.
- **Reachability (the seam that avoids a thin layer):** new `GoalSpec.taskTargets` (a general escape hatch from marketing flags) short-circuits `targetsFromGoal` → `selectByTargets` picks the node by its output. Brain tool `propose_task(capability, source_text)` (`atria-tools.ts`, map `TASK_CAPABILITIES`) builds a task goal and plans it via `master-agent.planFromGoal(goal, {skipClarification})` — skips the marketing clarification engine. Marketing goals never set `taskTargets`, so the golden 23/23 is unaffected.
- **Composition:** `email_writer.optional` now includes `summary`, so `taskTargets:['summary','email_result']` composes `summarize → email_writer → email_agent` (deriveDeps wires the edge; email_writer grounds the email on the summary).
- **Relationship to C1 + capability-gap:** C1 made selection target-driven so this composes with zero planner edits; capability-gap (P2) would have flagged "summarize" as missing — building it via the drop-in recipe **closes that loop** (gap → authored node → reachable). `TASK_CAPABILITIES` is where the next utility (translate, transcribe…) plugs in.
- **Guarded by:** `verify-summarize-node` (planner compose + runner + brain seam + **real executor run** producing a stored `summary` artifact); golden 23/23 + email/scheduler/capability-gap verifies unregressed.

### Atria brain reliability — explicit thinking budget (fix, this commit)
Fixes spurious "sorry, I ran into a problem" replies. `gemini-2.5-flash`'s **default dynamic thinking** misbehaves with tools — it intermittently returns `finishReason=STOP` with EMPTY content parts, which the brain loop reads as a failed turn. Setting an **explicit** `thinkingConfig.thinkingBudget` (4096) in `atria-brain.ts` `doCall` fixes it deterministically while KEEPING real reasoning (the model self-limits below the ceiling). Measured: default → empty every time; explicit budget → a clean tool-call/reply every time. Baseline of a coming **per-agent-group thinking-budget policy** (see `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`).

### Per-agent-group thinking-budget policy (P6, `f2c9f98`)
Generalizes the brain fix above into a per-node policy: one module maps each registry agentId to its gemini-2.5 `thinkingBudget` ceiling — reasoning nodes 4096, creative nodes scaled by a new `goal.qualityPref`, `summarize` scaled by source length, action nodes 0. The budget is a CEILING (the model self-limits below it), so a generous value is ~free on easy turns.
- **Depends on:** the explicit-brain-budget fix (`b5c4f9c`) that established WHY (dynamic thinking + tools → empty replies); the `llm-json` seam (`callGeminiJson` now takes `opts.thinkingBudget`); `GoalSpec` (new `qualityPref` — additive, nullish-safe, so old persisted `wf_run.goal` rows default cleanly).
- **How (the zero-per-runner trick):** `agent-executor.executeNode` computes `thinkingBudgetFor(agentId, ctx)` and binds it onto `ctx.llmJsonFn` — but ONLY when the seam is the real call (a DRY-RUN stub sets `llmJsonFn`, so verification's no-spend/no-network contract is preserved). Every `ctx.llmJsonFn ?? callGeminiJson` runner (`ideation`, `strategy`, `campaign_strategist`, `email_writer`, `summarize`, `storyboard`/`video` planning) inherits its budget automatically. `atria-brain.doCall` reads the shared `BRAIN_THINKING_BUDGET`.
- **Flows touched:** intake — `requirement-analyzer` + `deterministic-analyzer` detect a stated quality preference conversationally ("chất lượng cao"/"high quality" → high; "nhanh"/"tiết kiệm" → economy) → any orchestration run applies the per-node budget on the wire.
- **Deliberately NOT touched:** node SELECTION (golden 23/23 unchanged — `qualityPref`/budget never change which nodes run) and copygen (`concept_writer` keeps `thinkingBudget:0`, the hard-won JSON-truncation fix), so the creative tier effectively lands on `email_writer`. `memory`/`analytics` seams are outside the runner map (default budget; dynamic growth deferred).
- **Guarded by:** `verify-thinking-budget` (25 checks: policy math + `callGeminiJson` body + real executor run proving the budget reaches the wire per node + DRY-RUN pass-through); golden 23/23 + summarize regression green.

### Task-seam hardening across refine/clarify (`81d4d86`)
Closes the one real gap found when rescanning whether P3/P4 (general `WorkflowProposal`/`TaskSpec`) were needed — they are not; the shipped `taskTargets` seam just had two marketing-shaped leaks on a follow-up turn.
- **Strengthens:** the `summarize` task seam (P5) and the P6 `qualityPref` field. `goal-merge.mergeGoals` now preserves `taskTargets`, `slots.sourceText`, and `qualityPref` (the last was a deterministic P6 regression — a stated "high quality" reset to 'standard' on the next marketing refine). `clarification-engine.evaluateClarification` early-returns `ready` for any `taskTargets` goal (it carries its own inputs; the runner enforces sufficiency), so a task never gets marketing questions even on the LLM-misroute path — making `propose_task`'s `skipClarification` defense-in-depth.
- **Blast radius:** none for marketing (goals never set `taskTargets` → golden 23/23 byte-identical). **Defers:** P3/P4 remain YAGNI; revive trigger = a 2nd `TASK_CAPABILITIES` entry or real multi-turn task refinement.
- **Guarded by:** `verify-master` (task-goal survives merge + still selects `summarize`; `qualityPref` survives refine; a new stated pref wins).

### Scheduled email: confirmed schedule persists across turns (`0f89f51`)
Fixes a birthday email + "tomorrow morning" planning as `email_writer → email_agent` with no `scheduler` node. The splice (`workflow-planner`) and carry-via-`priorGoal` were correct; the schedule was never persisted because `set_schedule` wrote to a turn-scoped `ctx.scheduleProposal` that only lands on a run if `propose_workflow` runs the same turn — and the tool note told the model to defer it (contradicting the system prompt).
- **Depends on:** the generic-scheduler node + `email_writer→scheduler→email_agent` composition (Composable planner C1). **Touches:** `atria-tools` (set_schedule guidance), `conversation-author` (now surfaces `schedule{at,timezone,confirmed}` so the reply reads the time back to confirm), `conversation-prompt`.
- **Guarded by:** `verify-master` (merge keeps `schedule.at`+`needsEmail`; confirmed goal splices `scheduler` before `email_agent`; reply asks to confirm).
- **Extended (`766184f`):** `0f89f51` fixed the guidance but left the mechanism conditional on the model obeying it — observed live, the brain called `set_schedule`, read the time back, and ended the turn, so the instant died with `ctx` (a reply-only turn persists an `answered` run with a null goal, which `PRE_EXEC` excludes → nothing to carry). `rescueScheduleProposal` (`atria-tools`) now builds the draft flow deterministically at the one clean turn-end in `atria-brain`, guarded on `ctx.proposal` so it never preempts a brain that was going to propose; `kind` comes from `parseEmailIntent`, the schedule still rides UNconfirmed. Same shape as the deterministic refine path in `orchestration-router` and for the same reason.

### Content language mirrors the chat (`bc2c60d`)
Fixes an English conversation producing a Vietnamese email. Content generators resolved language via `goal.slots.language` (a stale 'vi' inferred from recalled memory) → `user.defaultLanguage` → `DEFAULT_LANGUAGE='vi'` — the same untrustworthy signal the chat reply already stopped using.
- **Depends on:** `detect-language`; new `contentLanguageFor(message, prior)` derives the run's language from the actual message + the flow's established prior, never the analyzer's inferred slot. **Used by:** `atria-tools` `propose_workflow` + `propose_task` (sets `goal.slots.language`), consumed downstream by `resolveRunLanguage` (email/copy/media). **Also:** `clarification-engine` skips the platforms question for an email goal (mirrors the planner's `needsEmail` short-circuit); `atria-brain-prompt` reconciles the line-32/33 conflict so scheduling proposes even before the @ address is known.
- **Blast radius:** VN chats still produce VN content (detection catches accented + unaccented VN); golden 23/23. **Guarded by:** `verify-master` (+7: content mirrors chat / refine override / inferred-vi ignored; email goal never asks platforms).
- **Completed for Latin-script languages (`766184f`):** `bc2c60d` closed the memory-bleed half but left `contentLanguageFor` falling through to `'en'` whenever `detectLanguage` returned null — which is every Latin-script language (`id ms tl fr es de pt it`, 8 of the 22 the module names). Observed live: Atria replied in Indonesian and wrote English copy. The brain now DECLARES the message language (`message_language`, required on `propose_workflow`/`propose_task`/`set_schedule`), captured once per turn on `ToolContext.messageLanguage` so the schedule-rescue path resolves it too; `contentLanguageFor(message, prior, declared)` takes it as the third rule. **Anti-bleed invariant kept:** the declaration is refused for any code the script probes can see (`vi th ja ko zh ru ar he hi el`), since a null detection proves the message contains none of those scripts — so recalled VN memory still cannot force VN onto an English chat. **Guarded by:** `verify-master` (+11: id/fr/es accepted, BCP-47 narrowed, declared-vi refused, precedence unchanged).

### In-flight Atria runs resumable from the Command Center (`473875d`)
A non-marketing run (email/task) is a post-less `kind=instance`, so one paused at an approval gate surfaced nowhere (Saved Flows = templates, Scheduled = already-approved, Workspace = campaigns) — reachable only by remembering its chat.
- **Depends on:** `getRunByChat`/`selectChat` (reopening a chat restores the paused flow card, any status). **Adds:** `listResumableRuns` + `GET /orchestration/runs/resumable`; the Command Center "Continue where you left off" cards render these as ⚡ status-labelled cards that resume via the run's chat (de-duped from the plain recent-chat list). **Complements:** the Scheduled page (a run moves there once approved → `scheduled`).

### Command Center voice launch + dismissable resume cards (`ab285f2`)
Two CC quality-of-life additions on top of the resume-cards feature.
- **Voice:** a 🎙️ button on the CC command bar opens Atria chat directly in hands-free voice mode. Reuses the OrchestratePanel voice stack (`useSpeechRecognition` + `tts-player` + `voiceMode`) via a new `autoVoice` prop that fires `toggleVoiceMode` on the false→true edge (the panel isn't remounted per open, so it watches the flag). `App.launchVoice` sets it; every other open path (`openOrchestrate`/`launchFromCommandCenter`/`selectChat`/`closeCcChat`) clears it. Gated on Web Speech API support.
- **Dismiss:** each "Continue where you left off" card gets a ✕ that deletes the underlying item — chat → `DELETE /agent/chats/:id`, run/flow → `DELETE /orchestration/runs/:id` (a `running` run refuses 409 rather than orphaning its executor) — then refreshes the affected list. Depends on the resume-cards feature (`473875d`); the card is wrapped so the ✕ is a sibling, not a nested `<button>`.

### Copy edits reach the media agents — `keyMessage` re-derived on mirror (`88a2282`)
Closes a silent cross-feature break between **copy editing** and **media generation**, found in the
2026-07-22 observed live test.

`concept_writer` stores `keyMessage` as a snapshot of the copy body (`copy.body.slice(0,200)`) on the
`content_concept` artifact. The three routes that change copy afterwards — `/refine` (LLM instruction),
`/edit-copy` (hand edit) and `/select-variant` (pick a version) — each mirrored the new copy onto that
artifact so the workflow view reflects the change, but all three copied only `copy` and left
`keyMessage` at its pre-edit value.

- **What depended on it silently:** `runStoryboard` briefs every frame — carousel slides *and* video
  keyframes — on `concept.keyMessage`. So refining a post ("40% off, ends Friday") and then running
  the storyboard/video step generated media for the ORIGINAL message while the published body carried
  the new one. The two deliverables of one post disagreed, with nothing surfaced to the user.
- **Shape:** the copy-pasted mirror block is extracted to `src/api/concept-mirror.ts`
  (`mirrorCopyOntoConcept` + `deriveKeyMessage`), shared by all three routes, re-deriving `keyMessage`
  with the generator's own rule. A non-copy-bag value is skipped rather than written as a malformed
  artifact.
- **Touches:** posts router (refine / edit-copy / select-variant) → `content_concept` artifact →
  `storyboard` + `video` nodes. Covered in `verify-edit-loss`.

## Commit ledger

- **fix(orchestration): preserve email intent + recipient name across refine/confirm turns** (0733288)
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
- **chore(hooks): test-integrity gate + feature-ledger on commit** (7a19654)
  - `.claude/hooks/feature-ledger.cjs`
  - `.claude/hooks/test-integrity-guard.cjs`
  - `.claude/hooks/test-integrity-stop.cjs`
  - `.claude/settings.json`
  - `docs/feature-map.md`
- **docs(plan): final composable-planner plan (Track A / P1b)** (4cd7aa6)
  - `plans/260712-1649-atria-composable-planner/phase-01-c1-backward-chaining.md`
  - `plans/260712-1649-atria-composable-planner/phase-02-capability-gap-devnotify.md`
  - `plans/260712-1649-atria-composable-planner/phase-03-c2-workflow-proposal.md`
  - `plans/260712-1649-atria-composable-planner/phase-04-c3-taskspec.md`
  - `plans/260712-1649-atria-composable-planner/phase-05-node-authoring-verify.md`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **test(orchestration): expand planner golden-master to tiers + materializer slots** (6047d18)
  - `MKTAgent/src/orchestration/planner-golden-snapshot.json`
  - `MKTAgent/src/orchestration/verify-planner-golden.ts`
- **refactor(orchestration): backward-chaining agent selection (C1)** (0295323)
  - `MKTAgent/src/orchestration/master/artifact-graph.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `docs/feature-map.md`
- **feat(orchestration): capability-gap handling — Atria honestly flags missing capabilities (P2)** (2861dbe)
  - `MKTAgent/prisma/migrations/20260712112702_add_capability_gap_spec/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/atria-router.ts`
  - `MKTAgent/src/db/repos/roadmap-demand-repo.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-capability-gap.ts`
  - `docs/feature-map.md`
- **feat(orchestration): summarize node — first non-marketing capability, reachable + composable (P5)** (caa2d27)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/master-agent.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `docs/feature-map.md`
- **docs(plan): mark P1/P2/P5 done, P3/P4 superseded by lightweight task seam** (bdef900)
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **fix(orchestration): explicit brain thinking budget — stop spurious empty-reply apologies** (b5c4f9c)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `docs/feature-map.md`
- **docs(plan): phase-06 per-agent-group thinking-budget policy (design locked)** (0c8c883)
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`
- **feat(orchestration): per-agent-group thinking-budget policy (P6)** (f2c9f98)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/executor/agent-executor.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/llm-json.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/thinking-budget.ts`
  - `MKTAgent/src/orchestration/verify-thinking-budget.ts`
  - `docs/feature-map.md`
  - `plans/260712-1649-atria-composable-planner/phase-06-thinking-budget-policy.md`
- **docs(feature-map): describe P6 thinking-budget policy relationships** (a9aac26)
  - `docs/feature-map.md`
- **docs(feature-map): move P6 relationships into curated section** (cec3b83)
  - `docs/feature-map.md`
- **fix(orchestration): harden non-marketing task seam across refine/clarify** (81d4d86)
  - `MKTAgent/src/orchestration/master/clarification-engine.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
  - `plans/260712-1649-atria-composable-planner/plan.md`
- **docs(feature-map): task-seam hardening relationships** (90de7a9)
  - `docs/feature-map.md`
- **fix(orchestration): persist confirmed schedule so email flow splices the scheduler node** (0f89f51)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/conversation-author.ts`
  - `MKTAgent/src/orchestration/prompts/conversation-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **fix(orchestration): content language mirrors the chat; email-aware clarification; reconcile scheduling prompt** (bc2c60d)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/clarification-engine.ts`
  - `MKTAgent/src/orchestration/master/detect-language.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **feat(orchestration): surface in-flight Atria runs in Command Center resume cards** (473875d)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/db/repos/workflow-run-repo.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
- **docs(feature-map): curate schedule-persistence, content-language, resume-cards relationships** (a345669)
  - `docs/feature-map.md`
- **feat(web): Command Center voice launch + dismissable resume cards** (ab285f2)
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **docs(feature-map): CC voice launch + dismissable resume cards relationships** (6013881)
  - `docs/feature-map.md`
- **feat(cc): collapsible 2-tier agent constellation grouped by function** (93d3cdd)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/orchestration/registry/agent-groups.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/vision-agents.ts`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **docs(feature-map): 2-tier grouped constellation relationships** (acf8985)
  - `docs/feature-map.md`
- **fix(cc): member labels no longer overlap when a group expands** (08c7efb)
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **feat(web): default UI copy to English; declutter + fix Command Center constellation** (549925c)
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/impact-report.tsx`
  - `MKTAgent/web/src/components/orchestrate-run-cards.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/read-aloud-button.tsx`
  - `MKTAgent/web/src/components/scheduled-view.tsx`
  - `MKTAgent/web/src/components/top-nav.tsx`
  - `MKTAgent/web/src/components/workspace-menu.tsx`
  - `MKTAgent/web/src/components/workspace-panel.tsx`
- **fix(atria): stop campaign/flow intent confusion + inherit platforms** (5eeff26)
  - `MKTAgent/src/api/campaigns-router.ts`
  - `MKTAgent/src/api/orchestration-chat.ts`
  - `MKTAgent/src/orchestration/master/campaign-intent.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/verify-campaign-intent.ts`
  - `MKTAgent/src/orchestration/verify-campaign-platform-inherit-http.ts`
- **feat(atria): demo-readiness — instructions/memory in brain, email-by-name, voice one-button, strategist inline** (ae95f52)
  - `MKTAgent/src/api/memory-router.ts`
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/db/repos/lead-repo.ts`
  - `MKTAgent/src/memory/user-memory.ts`
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/prompts/resolve-instructions.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/verify-capability-gap.ts`
  - `MKTAgent/src/orchestration/verify-instructions-and-memory.ts`
  - `MKTAgent/src/orchestration/verify-nurture-email-from-chat.ts`
  - `MKTAgent/src/orchestration/verify-p6-seed-session.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/memory-panel.tsx`
  - `MKTAgent/web/src/components/orchestrate-run-cards.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/styles.css`
- **docs(demo-readiness): plan phase logs + P6 ui-validation + feature-map** (0885234)
  - `docs/feature-map.md`
  - `plans/260713-1743-demo-readiness-full-fix/phase-01-voice-cc-unification.md`
  - `plans/260713-1743-demo-readiness-full-fix/phase-02-strategist-proposal-in-chat.md`
  - `plans/260713-1743-demo-readiness-full-fix/phase-03-nurture-email-by-lead-from-chat.md`
  - `plans/260713-1743-demo-readiness-full-fix/phase-04-instructions-ground-atria-ideas.md`
  - `plans/260713-1743-demo-readiness-full-fix/phase-05-memory-smarter.md`
  - `plans/260713-1743-demo-readiness-full-fix/phase-06-ui-flow-validation.md`
  - `plans/260713-1743-demo-readiness-full-fix/plan.md`
  - `plans/260713-1743-demo-readiness-full-fix/ui-validation/README.md`
- **feat(cc): widen constellation — groups + members sit further out for breathing room** (84482a9)
  - `MKTAgent/web/src/components/command-center-page.tsx`
- **fix(cc): constellation groups form a true circle (equal distance from Atria)** (e339870)
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/styles.css`
- **docs(changelog): demo-readiness full-fix + constellation circle (2026-07-13)** (95b3656)
  - `docs/feature-map.md`
  - `docs/project-changelog.md`
- **fix(atria): personal email routing, robust schedule splice, voice auto-start** (96fee2e)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/verify-scheduler-node.ts`
  - `MKTAgent/src/orchestration/master/clarification-engine.ts`
  - `MKTAgent/src/orchestration/master/conversation-author.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/prompts/resolve-instructions.ts`
  - `MKTAgent/src/orchestration/verify-instructions-and-memory.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
- **fix(atria): brain declares intent kind (email vs marketing); prime mic on voice launch** (67d9621)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/web/src/components/command-center-page.tsx`
- **fix(voice): auto-start listening reliably (defer past StrictMode double-mount)** (c566347)
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
- **docs(test): observed full-app browser test playbook + turnkey launch harness** (efdd6d4)
  - `plans/260714-0015-full-app-browser-test/launch-observed-browser.sh`
  - `plans/260714-0015-full-app-browser-test/plan.md`
- **feat(atria): Data Guard node masks GDPR/PII before summarize + fix plan-refine removals & plan-card copy** (777d17e)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `MKTAgent/web/src/components/orchestrate-run-cards.tsx`
  - `MKTAgent/web/src/components/run-dag-view.tsx`
  - `MKTAgent/web/src/flow/artifact-format.ts`
  - `plans/reports/test-report-260714-1423-observed-browser-test.md`
  - Relationships:
    - `security` (Data Guard) is a new registry node in the SAME composable graph as `summarize`, `scheduler`, etc. — added via a registry entry + runner + PIPELINE_ORDER slot, no planner special-case.
    - `summarize` now DEPENDS ON `security` (`requires: ['security_scan']`), so the backward-chaining planner (`workflow-planner.ts`) always places Data Guard first; `summarize` reads the masked text from the upstream `security_scan` artifact.
    - Reachable via the brain's `propose_task` seam (atria-tools) — same path as the original summarize task; the composition (security→summarize→optionally email_writer) is automatic.
    - The plan-refine removals fix touches the same `propose_workflow` path used by every marketing/email refine turn (reuses `applyRemovals` from goal-merge, previously only wired into the classic master-agent path).
- **docs(feature-map): record Data Guard node relationships** (653be2e)
  - `docs/feature-map.md`
- **feat(summarize): upload a document to summarize + fix flaky brain confirm & research-then-email** (aeb4b2f)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/api/product-knowledge-router.ts`
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/verify-email-node.ts`
  - `MKTAgent/src/product-knowledge/analyze-documents.ts`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - Relationships:
    - Document upload REUSES the product-knowledge Gemini multimodal transport (`extractDocumentText` sits beside `analyzeDocuments`, same `SUPPORTED_MIME`/base64 path) — no new upload infra.
    - The upload path DELIBERATELY bypasses the Atria brain: `POST /orchestration/summarize-file` builds the `security → summarize` run directly (via `masterAgent.planFromGoal` + `persistOutcome`), because raw PII would trip the chat LLM's safety filter. Depends on the Data Guard node (777d17e) to mask before summarizing.
    - Composer "+" (OrchestratePanel) → `extractDocumentText` → `summarizeFile` → `applyRun` (same plan-card path a typed request uses).
    - BUG-4 retry/logging wraps the brain loop's `callGemini` (touches EVERY chat turn); BUG-7 touches the email planning path (`emailOutputs` + email target in `workflow-planner` + `email_writer.optional`) so "research → email" composes `content_search → email_writer → email_agent`.
- **docs(feature-map): record document-upload summarize relationships** (83e5e98)
  - `docs/feature-map.md`
- **fix(atria): reliably re-plan on remove-node refinements (BUG-1 completion)** (0b2b881)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
- **fix(atria): deterministic plan refinement so node edits always apply (BUG-1)** (239cb65)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/api/schemas.ts`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
- **docs(test): post-fix 9-scenario re-run report** (7113e19)
  - `plans/reports/test-report-260714-1659-rerun-post-fixes.md`
- **fix(atria): pin reply language to the user's message, not the context language** (ea69f08)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
- **feat(atria): reliably record requests for capabilities that don't exist yet** (4e228fd)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - Relationships:
    - REUSES the capability-gap mechanism (`recordCapabilityGap` → `mkt_roadmap_demand`, surfaced by `GET /atria/roadmap-demand`) — the same one `flag_capability_gap` already fed. No new table.
    - Deterministic signal = the PLANNER/REGISTRY failure: `propose_task` (atria-tools) now accepts any capability id and, when `TASK_CAPABILITIES` has no producer, auto-logs the request instead of depending on the brain to separately call `flag_capability_gap` (which it skips ~always).
    - Complements the composable planner (`workflow-planner` backward-chaining): "no node produces this artifact" is exactly the capability-gap the registry already models; this turns that into a recorded demand signal for the DEV backlog.
    - Open follow-up: Case 2 (a user 👎/dislike on a proposed flow → record "wrong flow" demand) not yet built.
- **docs(feature-map): capability-request recording relationships** (02aec09)
  - `docs/feature-map.md`
- **docs(plan): credit wallet + super-admin grant system plan** (2c5ecdc)
  - `plans/260714-1815-credit-wallet-admin-grant/phase-01-balance-and-debit.md`
  - `plans/260714-1815-credit-wallet-admin-grant/phase-02-gating-and-display.md`
  - `plans/260714-1815-credit-wallet-admin-grant/phase-03-superadmin-page.md`
  - `plans/260714-1815-credit-wallet-admin-grant/plan.md`
- **feat(credits): real credit wallet + gating + super-admin grant console** (6c753be)
  - `MKTAgent/prisma/migrations/20260714133747_credit_wallet_and_superadmin/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/admin-router.ts`
  - `MKTAgent/src/api/auth-router.ts`
  - `MKTAgent/src/api/middleware-superadmin.ts`
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/api/verify-credit-gating-and-admin-http.ts`
  - `MKTAgent/src/db/repos/credit-repo.ts`
  - `MKTAgent/src/db/repos/roadmap-demand-repo.ts`
  - `MKTAgent/src/db/repos/verify-credit-wallet.ts`
  - `MKTAgent/src/db/repos/workflow-run-repo.ts`
  - `MKTAgent/src/orchestration/executor/workflow-executor.ts`
  - `MKTAgent/src/scripts/set-superadmin.ts`
  - `MKTAgent/src/server.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/app-nav.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/SuperAdminPage.tsx`
  - `MKTAgent/web/src/components/UsageDashboard.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/saved-flow-detail.tsx`
  - `MKTAgent/web/src/components/top-nav.tsx`
  - `docs/project-changelog.md`
  - `plans/260714-1815-credit-wallet-admin-grant/phase-01-balance-and-debit.md`
  - `plans/260714-1815-credit-wallet-admin-grant/phase-02-gating-and-display.md`
  - `plans/260714-1815-credit-wallet-admin-grant/phase-03-superadmin-page.md`
  - `plans/260714-1815-credit-wallet-admin-grant/plan.md`
- **docs(feature-map): credit wallet + super-admin console relationships** (de16d23)
  - `docs/feature-map.md`
- **fix: gate-after-content, Data Guard chunking, recipient-carry, calendar + attach** (9f915fa)
  - `MKTAgent/src/api/orchestration-router.ts`
  - `MKTAgent/src/api/verify-credit-gating-and-admin-http.ts`
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/executor/workflow-executor.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/content-calendar.tsx`
  - `MKTAgent/web/src/styles.css`
- **feat(nurture): two-way human-gated lead-nurture agent** (759ab22)
  - `FEATURES.md`
  - `FEATURES2.md`
  - `MKTAgent/.env.example`
  - `MKTAgent/prisma/migrations/20260715064909_nurture_threads/migration.sql`
  - `MKTAgent/prisma/migrations/20260715070741_nurture_replies/migration.sql`
  - `MKTAgent/prisma/migrations/20260715072447_nurture_brain/migration.sql`
  - `MKTAgent/prisma/migrations/20260715075719_nurture_settings/migration.sql`
  - `MKTAgent/prisma/migrations/20260715083349_dm_nurture/migration.sql`
  - `MKTAgent/prisma/migrations/20260715091730_lead_handle_only/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/email-router.ts`
  - `MKTAgent/src/api/leads-router.ts`
  - `MKTAgent/src/api/nurture-mappers.ts`
  - `MKTAgent/src/api/nurture-router.ts`
  - `MKTAgent/src/assets/drive-client.ts`
  - `MKTAgent/src/config/env.ts`
  - `MKTAgent/src/db/repos/lead-repo.ts`
  - `MKTAgent/src/db/repos/post-repo.ts`
  - `MKTAgent/src/db/repos/user-repo.ts`
  - `MKTAgent/src/email/gmail-send.ts`
  - `MKTAgent/src/leads/backfill-lead-pii.ts`
  - `MKTAgent/src/leads/normalize.ts`
  - `MKTAgent/src/leads/notify.ts`
  - `MKTAgent/src/leads/service.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/linkedin.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/meta.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/threads.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/x.ts`
  - `MKTAgent/src/leads/sources/comment-poller.ts`
  - `MKTAgent/src/leads/sources/meta-webhook.ts`
  - `MKTAgent/src/leads/sources/verify-comment-capture.ts`
  - `MKTAgent/src/leads/verify-leads-comments.ts`
  - `MKTAgent/src/messaging/dm-runners.ts`
  - `MKTAgent/src/messaging/index.ts`
  - `MKTAgent/src/messaging/opt-in-repo.ts`
  - `MKTAgent/src/messaging/telegram-webhook-router.ts`
  - `MKTAgent/src/messaging/telegram.ts`
  - `MKTAgent/src/messaging/types.ts`
  - `MKTAgent/src/messaging/verify-dm-node.ts`
  - `MKTAgent/src/messaging/whatsapp.ts`
  - `MKTAgent/src/messaging/zalo.ts`
  - `MKTAgent/src/nurture/decision-schema.ts`
  - `MKTAgent/src/nurture/enroll.ts`
  - `MKTAgent/src/nurture/gmail-read.ts`
  - `MKTAgent/src/nurture/guardrails.ts`
  - `MKTAgent/src/nurture/nurture-brain-prompt.ts`
  - `MKTAgent/src/nurture/nurture-brain.ts`
  - `MKTAgent/src/nurture/nurture-cron.ts`
  - `MKTAgent/src/nurture/nurture-reply-cron.ts`
  - `MKTAgent/src/nurture/nurture-reply-poller.ts`
  - `MKTAgent/src/nurture/nurture-runner.ts`
  - `MKTAgent/src/nurture/nurture-thread-repo.ts`
  - `MKTAgent/src/nurture/nurture-tools.ts`
  - `MKTAgent/src/nurture/reply-repo.ts`
  - `MKTAgent/src/nurture/sequence.ts`
  - `MKTAgent/src/nurture/verify-nurture-brain.ts`
  - `MKTAgent/src/nurture/verify-nurture-drip.ts`
  - `MKTAgent/src/nurture/verify-nurture-e2e.ts`
  - `MKTAgent/src/nurture/verify-reply-ingestion.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/registry/vision-agents.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/verify-email-node.ts`
  - `MKTAgent/src/server.ts`
  - `MKTAgent/src/social/facebook.ts`
  - `MKTAgent/src/social/greeting.ts`
  - `MKTAgent/src/social/instagram.ts`
  - `MKTAgent/src/social/threads.ts`
  - `MKTAgent/src/social/types.ts`
  - `MKTAgent/src/social/verify-greeting-node.ts`
  - `MKTAgent/src/social/x.ts`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/nurture-inbox-panel.tsx`
  - `MKTAgent/web/src/components/nurture-settings-panel.tsx`
  - `MKTAgent/web/src/components/nurture-thread-timeline.tsx`
  - `docs/feature-map.md`
  - `plans/260710-1132-p5-design-neural/plan.md`
  - `plans/260713-1251-lead-nurture-agent/phase-01-nurture-state-and-drip-engine.md`
  - `plans/260713-1251-lead-nurture-agent/phase-02-gmail-read-and-reply-ingestion.md`
  - `plans/260713-1251-lead-nurture-agent/phase-03-nurture-brain-and-conversation.md`
  - `plans/260713-1251-lead-nurture-agent/phase-04-approval-inbox-guardrails-verify.md`
  - `plans/260713-1251-lead-nurture-agent/plan.md`
  - `plans/260713-1251-multichannel-nurture-nodes/decision-checklist.md`
  - `plans/260713-1251-multichannel-nurture-nodes/phase-01-dm-nurture-nodes.md`
  - `plans/260713-1251-multichannel-nurture-nodes/phase-02-wall-greeting-engagement-nodes.md`
  - `plans/260713-1251-multichannel-nurture-nodes/phase-03-lead-capture-extension.md`
  - `plans/260713-1251-multichannel-nurture-nodes/plan.md`
  - `plans/260713-1251-multichannel-nurture-nodes/research-synthesis.md`
  - `plans/reports/debugger-260713-1251-atria-campaign-vs-flow-confusion.md`
  - `plans/reports/researcher-260713-1251-dm-nurture-apis.md`
  - `plans/reports/researcher-260713-1251-wall-post-and-comment-capture-apis.md`
- **feat(nurture): two-way human-gated lead-nurture agent** (e4e8f5c)
  - `MKTAgent/.env.example`
  - `MKTAgent/prisma/migrations/20260715064909_nurture_threads/migration.sql`
  - `MKTAgent/prisma/migrations/20260715070741_nurture_replies/migration.sql`
  - `MKTAgent/prisma/migrations/20260715072447_nurture_brain/migration.sql`
  - `MKTAgent/prisma/migrations/20260715075719_nurture_settings/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/leads-router.ts`
  - `MKTAgent/src/api/nurture-mappers.ts`
  - `MKTAgent/src/api/nurture-router.ts`
  - `MKTAgent/src/config/env.ts`
  - `MKTAgent/src/db/repos/lead-repo.ts`
  - `MKTAgent/src/email/gmail-send.ts`
  - `MKTAgent/src/nurture/decision-schema.ts`
  - `MKTAgent/src/nurture/enroll.ts`
  - `MKTAgent/src/nurture/gmail-read.ts`
  - `MKTAgent/src/nurture/guardrails.ts`
  - `MKTAgent/src/nurture/nurture-brain-prompt.ts`
  - `MKTAgent/src/nurture/nurture-brain.ts`
  - `MKTAgent/src/nurture/nurture-cron.ts`
  - `MKTAgent/src/nurture/nurture-reply-cron.ts`
  - `MKTAgent/src/nurture/nurture-reply-poller.ts`
  - `MKTAgent/src/nurture/nurture-runner.ts`
  - `MKTAgent/src/nurture/nurture-thread-repo.ts`
  - `MKTAgent/src/nurture/nurture-tools.ts`
  - `MKTAgent/src/nurture/reply-repo.ts`
  - `MKTAgent/src/nurture/sequence.ts`
  - `MKTAgent/src/nurture/verify-nurture-brain.ts`
  - `MKTAgent/src/nurture/verify-nurture-drip.ts`
  - `MKTAgent/src/nurture/verify-nurture-e2e.ts`
  - `MKTAgent/src/nurture/verify-reply-ingestion.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/server.ts`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/nurture-inbox-panel.tsx`
  - `MKTAgent/web/src/components/nurture-settings-panel.tsx`
  - `MKTAgent/web/src/components/nurture-thread-timeline.tsx`
  - `plans/260713-1251-lead-nurture-agent/phase-01-nurture-state-and-drip-engine.md`
  - `plans/260713-1251-lead-nurture-agent/phase-02-gmail-read-and-reply-ingestion.md`
  - `plans/260713-1251-lead-nurture-agent/phase-03-nurture-brain-and-conversation.md`
  - `plans/260713-1251-lead-nurture-agent/phase-04-approval-inbox-guardrails-verify.md`
  - `plans/260713-1251-lead-nurture-agent/plan.md`
  - `plans/reports/debugger-260713-1251-atria-campaign-vs-flow-confusion.md`
- **feat(messaging): multi-channel DM, greeting, and comment-capture nodes (DRY-RUN)** (d789bfd)
  - `MKTAgent/prisma/migrations/20260715083349_dm_nurture/migration.sql`
  - `MKTAgent/prisma/migrations/20260715091730_lead_handle_only/migration.sql`
  - `MKTAgent/src/api/email-router.ts`
  - `MKTAgent/src/assets/drive-client.ts`
  - `MKTAgent/src/db/repos/post-repo.ts`
  - `MKTAgent/src/db/repos/user-repo.ts`
  - `MKTAgent/src/leads/backfill-lead-pii.ts`
  - `MKTAgent/src/leads/normalize.ts`
  - `MKTAgent/src/leads/notify.ts`
  - `MKTAgent/src/leads/service.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/linkedin.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/meta.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/threads.ts`
  - `MKTAgent/src/leads/sources/comment-fetchers/x.ts`
  - `MKTAgent/src/leads/sources/comment-poller.ts`
  - `MKTAgent/src/leads/sources/meta-webhook.ts`
  - `MKTAgent/src/leads/sources/verify-comment-capture.ts`
  - `MKTAgent/src/leads/verify-leads-comments.ts`
  - `MKTAgent/src/messaging/dm-runners.ts`
  - `MKTAgent/src/messaging/index.ts`
  - `MKTAgent/src/messaging/opt-in-repo.ts`
  - `MKTAgent/src/messaging/telegram-webhook-router.ts`
  - `MKTAgent/src/messaging/telegram.ts`
  - `MKTAgent/src/messaging/types.ts`
  - `MKTAgent/src/messaging/verify-dm-node.ts`
  - `MKTAgent/src/messaging/whatsapp.ts`
  - `MKTAgent/src/messaging/zalo.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/registry/vision-agents.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/verify-email-node.ts`
  - `MKTAgent/src/social/facebook.ts`
  - `MKTAgent/src/social/greeting.ts`
  - `MKTAgent/src/social/instagram.ts`
  - `MKTAgent/src/social/threads.ts`
  - `MKTAgent/src/social/types.ts`
  - `MKTAgent/src/social/verify-greeting-node.ts`
  - `MKTAgent/src/social/x.ts`
  - `MKTAgent/web/src/api/client.ts`
  - `plans/260713-1251-multichannel-nurture-nodes/decision-checklist.md`
  - `plans/260713-1251-multichannel-nurture-nodes/phase-01-dm-nurture-nodes.md`
  - `plans/260713-1251-multichannel-nurture-nodes/phase-02-wall-greeting-engagement-nodes.md`
  - `plans/260713-1251-multichannel-nurture-nodes/phase-03-lead-capture-extension.md`
  - `plans/260713-1251-multichannel-nurture-nodes/plan.md`
  - `plans/260713-1251-multichannel-nurture-nodes/research-synthesis.md`
  - `plans/reports/researcher-260713-1251-dm-nurture-apis.md`
  - `plans/reports/researcher-260713-1251-wall-post-and-comment-capture-apis.md`
- **docs(feature-map): describe bug-batch, lead-nurture, and multi-channel nurture relationships** (e338f26)
  - `docs/feature-map.md`
- **docs(test): observed live-test retest report (10/10 scripts, 3 fixes)** (cff5339)
  - `plans/reports/test-report-260715-1747-observed-live-retest.md`
- **docs(changelog): 2026-07-15 bug batch, lead-nurture, multichannel, live-test fixes** (0bb0475)
  - `docs/project-changelog.md`
- **fix(credits): bill runs from real USD, ending LLM double-count** (33d805b)
  - `MKTAgent/src/db/repos/verify-credit-wallet.ts`
  - `MKTAgent/src/db/repos/workflow-run-repo.ts`
- **docs(product): full product documentation set from codebase scan** (2665aff)
  - `docs/feature-map.md`
  - `docs/product/01-architecture-techstack-layers.md`
  - `docs/product/02-logic-gates-rules-guardrails.md`
  - `docs/product/03-hardcoded-inventory-and-flexibility.md`
  - `docs/product/04-capabilities-and-human-in-the-loop.md`
  - `docs/product/05-agent-nodes-architecture.md`
  - `docs/product/06-technical-debt-and-improvements.md`
  - `docs/product/07-dynamic-subagent-orchestration-gap.md`
  - `docs/product/08-making-agent-nodes-real-subagents.md`
  - `docs/product/09-today-actionable.md`
  - `docs/product/README.md`
- **test(verify): add aggregate runner for the 83 verify scripts** (6b18b1f)
  - `MKTAgent/package.json`
  - `MKTAgent/src/connectors/registry/verify-registry.ts`
  - `MKTAgent/src/scripts/run-verify.ts`
  - `docs/feature-map.md`
- **test(verify): boot the server for the http tier; retract a bad debt item** (3aa623c)
  - `MKTAgent/src/api/verify-post-from-agent.ts`
  - `MKTAgent/src/scripts/run-verify.ts`
  - `docs/feature-map.md`
  - `docs/product/06-technical-debt-and-improvements.md`
  - `docs/product/09-today-actionable.md`
- **feat(security): helmet headers + inbound rate limits on auth and LLM routes** (08a1972)
  - `MKTAgent/package-lock.json`
  - `MKTAgent/package.json`
  - `MKTAgent/src/api/rate-limits.ts`
  - `MKTAgent/src/server.ts`
  - `docs/feature-map.md`
  - `docs/product/09-today-actionable.md`
- **docs(feature-map): relationships for the verify runner and inbound rate limits** (bd74e84)
  - `docs/feature-map.md`
- **feat(cost): declare "re-runs are on us" as policy and report what it absorbs** (7c399e7)
  - `MKTAgent/src/cost/spend-split.ts`
  - `MKTAgent/src/db/repos/workflow-run-repo.ts`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/components/UsageDashboard.tsx`
  - `docs/product/06-technical-debt-and-improvements.md`
- **docs(feature-map): relationships for the credit-scale unification and re-run policy** (1f572d6)
  - `docs/feature-map.md`
- **chore(feature-map): commit ledger stub** (f968456)
  - `docs/feature-map.md`
- **@ docs(features): commit the product feature inventory** (cadaa91)
  - `FEATURES.md`
  - `docs/feature-map.md`
- **docs(features): commit the product feature inventory** (9ca029a)
  - `FEATURES.md`
  - `docs/feature-map.md`
- **docs(features): commit the product feature inventory** (b7f6435)
  - `FEATURES.md`
  - `docs/feature-map.md`
- **docs(plan): mark P5 neural-skin plan complete** (2f84330)
  - `plans/260710-1132-p5-design-neural/plan.md`
- **chore(feature-map): commit ledger stubs** (335b786)
  - `docs/feature-map.md`
- **fix(hooks): stop the feature-ledger from logging its own commits** (33e6a83)
  - `.claude/hooks/__tests__/feature-ledger.test.cjs`
  - `.claude/hooks/feature-ledger.cjs`
  - `docs/feature-map.md`
- **@ docs: add a docs index, archive superseded handoffs, record the context audit** (cd2c95b)
  - `docs/README.md`
  - `docs/archive/next-session-p6-master-agent-creates-campaigns.md`
  - `docs/archive/next-session-p6-p8-flow-creation-ux.md`
  - `docs/archive/next-session-state-260702.md`
  - `docs/archive/next-session-state-260705.md`
  - `docs/archive/next-session-state-260706-pm.md`
  - `docs/archive/next-session-state-260706.md`
  - `docs/archive/next-session-state-260707.md`
  - `docs/product/README.md`
  - `plans/reports/audit-260721-1108-context-memory-cache-economics.md`
- **docs: add a docs index, archive superseded handoffs, record the context audit** (9e77c36)
  - `docs/README.md`
  - `docs/archive/next-session-p6-master-agent-creates-campaigns.md`
  - `docs/archive/next-session-p6-p8-flow-creation-ux.md`
  - `docs/archive/next-session-state-260702.md`
  - `docs/archive/next-session-state-260705.md`
  - `docs/archive/next-session-state-260706-pm.md`
  - `docs/archive/next-session-state-260706.md`
  - `docs/archive/next-session-state-260707.md`
  - `docs/product/README.md`
  - `plans/reports/audit-260721-1108-context-memory-cache-economics.md`
- **feat(orchestration): add video_script agent; render video from a script, not storyboard frames** (1492937)
  - `MKTAgent/src/api/orchestration-mappers.ts`
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/goal-merge.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/planner-golden-snapshot.json`
  - `MKTAgent/src/orchestration/prompts/agent-prompts.ts`
  - `MKTAgent/src/orchestration/prompts/requirement-prompt.ts`
  - `MKTAgent/src/orchestration/registry/agent-registry.ts`
  - `MKTAgent/src/orchestration/registry/agent-types.ts`
  - `MKTAgent/src/orchestration/schemas/artifact-schemas.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/schemas/workflow-plan.ts`
  - `MKTAgent/src/orchestration/testing/stub-llm-json.ts`
  - `MKTAgent/src/orchestration/thinking-budget.ts`
  - `MKTAgent/src/orchestration/verify-campaign-materializer.ts`
  - `MKTAgent/src/orchestration/verify-concept-gate.ts`
  - `MKTAgent/src/orchestration/verify-executor.ts`
  - `MKTAgent/src/orchestration/verify-flow-cost-rollup.ts`
  - `MKTAgent/src/orchestration/verify-planner.ts`
  - `MKTAgent/src/orchestration/verify-rerun-node.ts`
  - `MKTAgent/src/orchestration/verify-storyboard-video-dep.ts`
  - `MKTAgent/src/orchestration/verify-template-instance.ts`
  - `MKTAgent/src/orchestration/verify-video-script.ts`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/saved-flow-detail.tsx`
  - `MKTAgent/web/src/components/video-script-review.tsx`
  - `MKTAgent/web/src/flow/artifact-format.ts`
  - `MKTAgent/web/src/styles.css`
- **docs: record the media-quality track, its plans, and session state** (ba7ea2f)
  - `docs/feature-map.md`
  - `docs/product/05-agent-nodes-architecture.md`
  - `docs/project-changelog.md`
  - `plans/260721-1231-media-quality-video-script-agent/phase-01-infographic-overview-agent.md`
  - `plans/260721-1231-media-quality-video-script-agent/phase-02-video-script-node.md`
  - `plans/260721-1231-media-quality-video-script-agent/phase-03-decouple-video-from-storyboard.md`
  - `plans/260721-1231-media-quality-video-script-agent/phase-04-rewrite-video-runner.md`
  - `plans/260721-1231-media-quality-video-script-agent/phase-05-verify-and-cost.md`
  - `plans/260721-1231-media-quality-video-script-agent/plan.md`
  - `plans/260721-1343-video-length-and-quota-budget/plan.md`
  - `plans/reports/state-260721-1455-session-handoff.md`
- **feat(video): make runtime a user choice, demote videoTarget to rhythm and aspect** (8dac91f)
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/prompts/agent-prompts.ts`
  - `MKTAgent/src/orchestration/schemas/goal-spec.ts`
  - `MKTAgent/src/orchestration/verify-video-script.ts`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/saved-flow-detail.tsx`
  - `MKTAgent/web/src/components/video-script-review.tsx`
  - `docs/project-changelog.md`
  - `plans/260721-1343-video-length-and-quota-budget/plan.md`
- **fix(verify): make the http tier deterministic and green (85/85)** (ffa9b28)
  - `MKTAgent/src/api/verify-post-from-agent.ts`
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/verify-api.ts`
  - `MKTAgent/src/orchestration/verify-connect-form.ts`
  - `MKTAgent/src/orchestration/verify-video-script.ts`
  - `MKTAgent/src/scripts/run-verify.ts`
  - `docs/project-changelog.md`
- **docs: record the http-tier fix and write the pre-test session state** (1a2b496)
  - `docs/feature-map.md`
  - `plans/reports/state-260721-1730-session-handoff.md`
- **fix(copy): re-derive keyMessage when refined or hand-edited copy is mirrored** (88a2282)
  - `MKTAgent/src/api/concept-mirror.ts`
  - `MKTAgent/src/api/posts-router.ts`
  - `MKTAgent/src/orchestration/verify-edit-loss.ts`
  - `plans/reports/test-260722-1622-observed-live-test.md`
- **docs: record the observed live test — scripts 1-3, seven findings, resume recipe** (429d7d0)
  - `docs/feature-map.md`
  - `plans/reports/test-260722-1622-observed-live-test.md`
- **fix(orchestration): mirror the chat language in content, stop losing parsed schedules** (766184f)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/detect-language.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-capability-gap.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
  - `MKTAgent/src/orchestration/verify-nurture-email-from-chat.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
- **docs: record script 4 of the observed live test** (66136f5)
  - `plans/reports/test-260722-1744-script4-and-f7-fix.md`
- **fix(nurture): write emails to a lead in the LEAD's language, not the workspace default** (c473868)
  - `MKTAgent/src/orchestration/executor/agent-runners.ts`
  - `MKTAgent/src/orchestration/verify-nurture-email-from-chat.ts`
- **fix(ui): stop shipping half-translated controls while an i18n layer is planned** (8cef557)
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/impact-report.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/scheduled-view.tsx`
  - `MKTAgent/web/src/components/workspace-panel.tsx`
  - `MKTAgent/web/src/hooks/use-speech-recognition.ts`
- **docs: language-localization audit + the i18n plan that follows from it** (bd45da9)
  - `plans/260722-1949-i18n-full-surface/phase-01-locale-foundation.md`
  - `plans/260722-1949-i18n-full-surface/phase-02-api-message-envelope.md`
  - `plans/260722-1949-i18n-full-surface/phase-03-migrate-act-on-tier.md`
  - `plans/260722-1949-i18n-full-surface/phase-04-translation-pipeline.md`
  - `plans/260722-1949-i18n-full-surface/phase-05-enforcement.md`
  - `plans/260722-1949-i18n-full-surface/phase-06-chrome-tier.md`
  - `plans/260722-1949-i18n-full-surface/plan.md`
  - `plans/reports/audit-260722-1949-language-localization-gap.md`
  - `plans/reports/test-260722-1744-script4-and-f7-fix.md`
- **feat(i18n): locale foundation — uiLanguage, dependency-free t(), en/vi/id/ko catalogs** (c13c6b6)
  - `MKTAgent/prisma/migrations/20260724042534_ui_language/migration.sql`
  - `MKTAgent/prisma/schema.prisma`
  - `MKTAgent/src/api/auth-router.ts`
  - `MKTAgent/src/db/repos/user-repo.ts`
  - `MKTAgent/src/i18n/ui-languages.ts`
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/api/client.ts`
  - `MKTAgent/web/src/i18n/catalog.en.ts`
  - `MKTAgent/web/src/i18n/catalog.id.ts`
  - `MKTAgent/web/src/i18n/catalog.ko.ts`
  - `MKTAgent/web/src/i18n/catalog.vi.ts`
  - `MKTAgent/web/src/i18n/index.ts`
  - `MKTAgent/web/src/i18n/t-error.ts`
  - `MKTAgent/web/src/main.tsx`
- **fix(i18n): stop the server authoring the schedule-confirm sentence in the wrong language** (aa6ed2b)
  - `MKTAgent/src/api/http.ts`
  - `MKTAgent/src/lib/user-message.ts`
  - `MKTAgent/src/orchestration/master/conversation-author.ts`
- **test(i18n): enforcement gate — the mechanism that makes 'global' hold** (20c17dc)
  - `.claude/rules/development-rules.md`
  - `MKTAgent/src/orchestration/master/conversation-author.ts`
  - `MKTAgent/src/scripts/verify-i18n.ts`
  - `MKTAgent/web/src/i18n/i18n-migrated.json`
- **feat(i18n): migrate the act-on tier (12 components) to t()** (ebd755e)
  - `MKTAgent/src/scripts/verify-i18n.ts`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/PostCard.tsx`
  - `MKTAgent/web/src/components/UsageDashboard.tsx`
  - `MKTAgent/web/src/components/concept-selection-gate.tsx`
  - `MKTAgent/web/src/components/connection-required.tsx`
  - `MKTAgent/web/src/components/plan-tier-cards.tsx`
  - `MKTAgent/web/src/components/post-workflow-view.tsx`
  - `MKTAgent/web/src/components/publish-review.tsx`
  - `MKTAgent/web/src/components/saved-flow-detail.tsx`
  - `MKTAgent/web/src/components/scheduled-view.tsx`
  - `MKTAgent/web/src/components/video-script-review.tsx`
  - `MKTAgent/web/src/components/workspace-panel.tsx`
  - `MKTAgent/web/src/i18n/catalog.en.ts`
  - `MKTAgent/web/src/i18n/catalog.id.ts`
  - `MKTAgent/web/src/i18n/catalog.ko.ts`
  - `MKTAgent/web/src/i18n/catalog.vi.ts`
  - `MKTAgent/web/src/i18n/i18n-migrated.json`
- **feat(i18n): interface-language switcher in the top nav** (63193bb)
  - `MKTAgent/web/src/App.tsx`
  - `MKTAgent/web/src/components/language-switcher.tsx`
  - `MKTAgent/web/src/components/top-nav.tsx`
  - `MKTAgent/web/src/i18n/catalog.en.ts`
  - `MKTAgent/web/src/i18n/catalog.id.ts`
  - `MKTAgent/web/src/i18n/catalog.ko.ts`
  - `MKTAgent/web/src/i18n/catalog.vi.ts`
  - `MKTAgent/web/src/i18n/index.ts`
  - `MKTAgent/web/src/styles.css`
- **feat(i18n): build-time translation pipeline + top-nav chrome demo** (eff1eb8)
  - `MKTAgent/package.json`
  - `MKTAgent/src/scripts/i18n-translate.ts`
  - `MKTAgent/web/src/components/top-nav.tsx`
  - `MKTAgent/web/src/i18n/catalog.en.ts`
  - `MKTAgent/web/src/i18n/catalog.id.ts`
  - `MKTAgent/web/src/i18n/catalog.ko.ts`
  - `MKTAgent/web/src/i18n/catalog.vi.ts`
  - `MKTAgent/web/src/i18n/i18n-migrated.json`
- **feat(i18n): chrome-tier sweep + GLOBAL enforcement — the whole UI switches** (cbfd7f7)
  - `MKTAgent/src/scripts/verify-i18n.ts`
  - `MKTAgent/web/src/components/ConnectionsPanel.tsx`
  - `MKTAgent/web/src/components/DemoModeToggle.tsx`
  - `MKTAgent/web/src/components/LeadsPage.tsx`
  - `MKTAgent/web/src/components/OrchestratePanel.tsx`
  - `MKTAgent/web/src/components/ProductKnowledgeLibrary.tsx`
  - `MKTAgent/web/src/components/SuperAdminPage.tsx`
  - `MKTAgent/web/src/components/UsageDashboard.tsx`
  - `MKTAgent/web/src/components/atria-resume-work-cards.tsx`
  - `MKTAgent/web/src/components/atria-suggestion-cards.tsx`
  - `MKTAgent/web/src/components/campaign-command-view.tsx`
  - `MKTAgent/web/src/components/command-center-page.tsx`
  - `MKTAgent/web/src/components/connection-credential-form.tsx`
  - `MKTAgent/web/src/components/cost-strip.tsx`
  - `MKTAgent/web/src/components/email-panel.tsx`
  - `MKTAgent/web/src/components/impact-report.tsx`
  - `MKTAgent/web/src/components/instruction-editor.tsx`
  - `MKTAgent/web/src/components/memory-panel.tsx`
  - `MKTAgent/web/src/components/nurture-inbox-panel.tsx`
  - `MKTAgent/web/src/components/nurture-settings-panel.tsx`
  - `MKTAgent/web/src/components/nurture-thread-timeline.tsx`
  - `MKTAgent/web/src/components/orchestrate-run-cards.tsx`
  - `MKTAgent/web/src/components/product-knowledge-upload.tsx`
  - `MKTAgent/web/src/components/provider-spend-panel.tsx`
  - `MKTAgent/web/src/components/top-nav.tsx`
  - `MKTAgent/web/src/components/workspace-menu.tsx`
  - `MKTAgent/web/src/i18n/catalog.en.ts`
  - `MKTAgent/web/src/i18n/catalog.id.ts`
  - `MKTAgent/web/src/i18n/catalog.ko.ts`
  - `MKTAgent/web/src/i18n/catalog.vi.ts`
  - `MKTAgent/web/src/i18n/i18n-exempt.json`
  - `MKTAgent/web/src/i18n/i18n-migrated.json`
- **feat(i18n): add French — proves add-a-language is a catalog file + one pipeline run** (bef03f5)
  - `MKTAgent/src/i18n/ui-languages.ts`
  - `MKTAgent/src/scripts/i18n-translate.ts`
  - `MKTAgent/src/scripts/verify-i18n.ts`
  - `MKTAgent/web/src/i18n/catalog.fr.ts`
  - `MKTAgent/web/src/i18n/index.ts`
- **refactor(i18n): data-driven locale registry — adding a language is one row + one command** (928a86a)
  - `MKTAgent/src/i18n/ui-languages.ts`
  - `MKTAgent/src/scripts/i18n-translate.ts`
  - `MKTAgent/src/scripts/verify-i18n.ts`
  - `MKTAgent/web/src/i18n/catalog.fr.json`
  - `MKTAgent/web/src/i18n/catalog.id.json`
  - `MKTAgent/web/src/i18n/catalog.ko.json`
  - `MKTAgent/web/src/i18n/catalog.vi.json`
  - `MKTAgent/web/src/i18n/index.ts`
  - `MKTAgent/web/src/i18n/locales.ts`
- **feat(i18n): generate 21 more UI languages (th ja zh zh-TW ms tl km lo es pt de it nl uk pl tr hi bn ta ur fa)** (1845860)
  - `MKTAgent/web/src/i18n/catalog.bn.json`
  - `MKTAgent/web/src/i18n/catalog.bn.review.json`
  - `MKTAgent/web/src/i18n/catalog.de.json`
  - `MKTAgent/web/src/i18n/catalog.de.review.json`
  - `MKTAgent/web/src/i18n/catalog.es.json`
  - `MKTAgent/web/src/i18n/catalog.es.review.json`
  - `MKTAgent/web/src/i18n/catalog.fa.json`
  - `MKTAgent/web/src/i18n/catalog.fa.review.json`
  - `MKTAgent/web/src/i18n/catalog.hi.json`
  - `MKTAgent/web/src/i18n/catalog.hi.review.json`
  - `MKTAgent/web/src/i18n/catalog.it.json`
  - `MKTAgent/web/src/i18n/catalog.it.review.json`
  - `MKTAgent/web/src/i18n/catalog.ja.json`
  - `MKTAgent/web/src/i18n/catalog.ja.review.json`
  - `MKTAgent/web/src/i18n/catalog.km.json`
  - `MKTAgent/web/src/i18n/catalog.km.review.json`
  - `MKTAgent/web/src/i18n/catalog.lo.json`
  - `MKTAgent/web/src/i18n/catalog.lo.review.json`
  - `MKTAgent/web/src/i18n/catalog.ms.json`
  - `MKTAgent/web/src/i18n/catalog.ms.review.json`
  - `MKTAgent/web/src/i18n/catalog.nl.json`
  - `MKTAgent/web/src/i18n/catalog.nl.review.json`
  - `MKTAgent/web/src/i18n/catalog.pl.json`
  - `MKTAgent/web/src/i18n/catalog.pl.review.json`
  - `MKTAgent/web/src/i18n/catalog.pt.json`
  - `MKTAgent/web/src/i18n/catalog.pt.review.json`
  - `MKTAgent/web/src/i18n/catalog.ta.json`
  - `MKTAgent/web/src/i18n/catalog.ta.review.json`
  - `MKTAgent/web/src/i18n/catalog.th.json`
  - `MKTAgent/web/src/i18n/catalog.th.review.json`
  - `MKTAgent/web/src/i18n/catalog.tl.json`
  - `MKTAgent/web/src/i18n/catalog.tl.review.json`
  - `MKTAgent/web/src/i18n/catalog.tr.json`
  - `MKTAgent/web/src/i18n/catalog.tr.review.json`
  - `MKTAgent/web/src/i18n/catalog.uk.json`
  - `MKTAgent/web/src/i18n/catalog.uk.review.json`
  - `MKTAgent/web/src/i18n/catalog.ur.json`
  - `MKTAgent/web/src/i18n/catalog.ur.review.json`
  - `MKTAgent/web/src/i18n/catalog.zh-TW.json`
  - `MKTAgent/web/src/i18n/catalog.zh-TW.review.json`
  - `MKTAgent/web/src/i18n/catalog.zh.json`
  - `MKTAgent/web/src/i18n/catalog.zh.review.json`
- **feat(i18n): generate Burmese (my) + Russian (ru) UI catalogs** (38baa04)
  - `MKTAgent/web/src/i18n/catalog.my.json`
  - `MKTAgent/web/src/i18n/catalog.my.review.json`
  - `MKTAgent/web/src/i18n/catalog.ru.json`
  - `MKTAgent/web/src/i18n/catalog.ru.review.json`
- **feat(i18n): complete the set — Arabic + Hebrew, and make the pipeline model-robust** (60949cd)
  - `MKTAgent/src/scripts/i18n-translate.ts`
  - `MKTAgent/web/src/i18n/catalog.ar.json`
  - `MKTAgent/web/src/i18n/catalog.ar.review.json`
  - `MKTAgent/web/src/i18n/catalog.he.json`
  - `MKTAgent/web/src/i18n/catalog.he.review.json`
- **docs(i18n): completion handoff + plan status + changelog** (d0b7ba3)
  - `docs/project-changelog.md`
  - `plans/260722-1949-i18n-full-surface/plan.md`
  - `plans/reports/state-260724-1548-i18n-complete-resume-6b.md`
- **fix(atria): merge propose_task into propose_workflow, LLM-authoritative language, brain-loop robustness** (364fa7d)
  - `MKTAgent/src/orchestration/atria/atria-brain.ts`
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/detect-language.ts`
  - `MKTAgent/src/orchestration/master/workflow-planner.ts`
  - `MKTAgent/src/orchestration/prompts/atria-brain-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
  - `MKTAgent/src/orchestration/verify-summarize-node.ts`
  - `docs/project-changelog.md`
  - `plans/260724-1636-atria-merge-and-language-fix/phase-01-language-seam.md`
  - `plans/260724-1636-atria-merge-and-language-fix/plan.md`
  - `plans/reports/state-260724-1900-merge-language-done-resume.md`
  - `plans/reports/test-260724-1636-script6b-and-f15-mergeplan.md`
  - _Relationships:_ `propose_task` is REMOVED — `propose_workflow` is now the single brain entry point for
    both marketing/email flows AND content tasks (via `capability`/`source_text`/`email_to`). The workflow
    planner (`workflow-planner.ts`) now composes a task with a delivery (summarize→email) because
    `targetsFromGoal` unions `taskTargets` with `email_result`, riding `email_writer.optional: ['summary']`.
    `contentLanguageFor` (`detect-language.ts`) drives the content language of EVERY generated flow and is
    now LLM-authoritative; the atria brain loop (`atria-brain.ts`) hardens the Gemini function-calling seam
    that all these tools ride. Consumers of the old `propose_task` tool name (none external) must use
    `propose_workflow` + `capability`.
- **refactor(atria): goal extraction is LLM-authoritative — demote the regex override layers** (6630889)
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `docs/project-changelog.md`
  - _Relationships:_ `requirementAnalyzer` feeds `GoalSpec` to the whole marketing/email planning chain
    (propose_workflow → `masterAgent.planFromGoal` → `workflow-planner`). It stays LLM-primary with
    `analyzeDeterministic` as the no-LLM fallback; what changed is that the four intent-classification
    regex overrides (scope/autoPublish/qualityPref/email-routing) no longer second-guess the model —
    email routing is now owned solely by the brain's declared `kind` (atria-tools), consistent with the
    LLM-authoritative language decision in `detect-language.ts`. Only factual-token corroboration remains
    (platform-name union, language-agnostic @ recipient). No schema/contract change to `GoalSpec`.
- **@ fix(atria): LLM declares full goal intent — close the scope/autoPublish/quality regression** (44eee5c)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/prompts/requirement-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **@ fix(atria): LLM declares full goal intent — close the scope/autoPublish/quality regression** (de55175)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/prompts/requirement-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **fix(atria): LLM declares full goal intent — close the scope/autoPublish/quality regression** (25e02b5)
  - `MKTAgent/src/orchestration/atria/atria-tools.ts`
  - `MKTAgent/src/orchestration/master/deterministic-analyzer.ts`
  - `MKTAgent/src/orchestration/master/requirement-analyzer.ts`
  - `MKTAgent/src/orchestration/prompts/requirement-prompt.ts`
  - `MKTAgent/src/orchestration/verify-master.ts`
- **docs(plans): reply-language + regex→LLM intent migration plans** (5e8f2a5)
  - `plans/260725-1500-reply-language-llm-authoritative/plan.md`
  - `plans/260725-1600-regex-to-llm-intent-migration/plan.md`
- **docs(plan): mark regex→LLM migration Phase 3 done, Phase 4 not-started** (4f07885)
  - `plans/260725-1600-regex-to-llm-intent-migration/plan.md`
- **test(thinking-budget): inject fake key so the e2e binding runs under the aggregate suite** (0947b78)
  - `MKTAgent/src/orchestration/verify-thinking-budget.ts`
- **docs(architecture): raw explore-agent reports for architecture map** (bd05626)
  - `docs/feature-map.md`
  - `plans/260725-1600-architecture-map/agent-reports/01-orchestration.md`
  - `plans/260725-1600-architecture-map/agent-reports/02-api-data-auth.md`
  - `plans/260725-1600-architecture-map/agent-reports/03-leads-nurture-social-messaging.md`
  - `plans/260725-1600-architecture-map/agent-reports/04-media-copygen-cost-scheduler.md`
  - `plans/260725-1600-architecture-map/agent-reports/05-frontend-web.md`
  - `plans/260725-1600-architecture-map/agent-reports/06-repo-root-dirs.md`
- **docs(plan): full-product refactor plan (cleanup + hardening)** (f5f5b65)
  - `docs/feature-map.md`
  - `plans/260725-1600-architecture-map/refactor-plan.md`
- **docs(plan): flag refactor plan as paused pending 6 open-questions post-clear** (e46475d)
  - `plans/260725-1600-architecture-map/refactor-plan.md`
- **docs(plan): resolve 6 open-questions, add post-grep corrections** (85d1371)
  - `plans/260725-1600-architecture-map/refactor-plan.md`
- **feat(ci): add BE/FE drift guards + drop last dead export** (a1f8d70)
  - `MKTAgent/src/cost/verify-credits-mirror.ts`
  - `MKTAgent/src/social/verify-platform-asset-mirror.ts`
  - `MKTAgent/web/src/flow/demo-flow.ts`
- **docs: close docs-debt (code-standards.md, roadmap supersede banner)** (4931579)
  - `docs/README.md`
  - `docs/code-standards.md`
  - `docs/development-roadmap.md`
  - `docs/feature-map.md`
- **fix(ci): derive platform-asset guard from enum, re-tier to unit** (937d7e3)
  - `MKTAgent/src/scripts/run-verify.ts`
  - `MKTAgent/src/social/verify-platform-asset-mirror.ts`
