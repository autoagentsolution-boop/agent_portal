# Raw agent report — Media / Copygen / Cost / Scheduler / Memory / Assets (Agent 4)

> Raw output from the read-only explore agent. Feeds ARCHITECTURE_MAP.md §2, §3, §5, §6, §7.
> All cron workers OFF by default (env.ts:35-113).

## 1. src/copygen/ (9 files) — Post Copy Generation
Writes social post text (FB/IG body, Threads variant, X variant) via Gemini, grounded in product knowledge + brand voice. Ported from n8n "copy generation".
Files: service.ts (runCopyGenTick `:117`, refineForPost `:145`, generateVariantsForPost `:212`, generateForPost `:247`); prompt.ts (buildGeminiBody/buildVariantsBody — guardrails hook≤50/no-HTML/banned-buzzwords/Threads≤480/X≤280); gemini.ts (HTTP client 60s); parse.ts (JSON→copy, salvages truncated); resolve-config.ts (3-layer Post→Campaign→User); cron.ts (10min); cli.ts; verify-refine-and-overrides.ts, verify-variant-parse.ts.
Depends: scheduler/lock.ts, post/product-knowledge repos, prompts/resolve-instructions, cost/llm-usage, credit-repo, event bus. **Depended by:** executor concept_writer node, manual UI, copy-gen cron. parse.ts CopyVariants reused by scheduler/resolve-input.
Hidden: NO claim-to-intermediate-state (failure regenerable, `:6-9`); **thinking budget=0** stops Gemini 2.5 truncating JSON "Unterminated string" + saves money (`prompt.ts:131,171`); maxOutputTokens 8192→**16384** for multi-variant (`:168`); hook≤50/Threads≤480/X≤280 verbatim from n8n (`:95-98`, re-enforced parse.ts:121-122); temp 0.95/1.0 (`:125,165`); **refine billing tag copygen_refine + runId** so refine spend added without double-count (`service.ts:164-171`); refine reconciles credits immediately (can happen AFTER run completed `:181-193`); **default lang fallback='vi'** shared with media (`resolve-config.ts:11,36`); persona-free on null brand voice (`prompt.ts:34-49`); JSON salvage walker (`parse.ts:50-75`).
**Risk HIGH** — guardrails ported verbatim + billing-tag semantics wired into wallet.

## 2. src/cost/ (6 files) — LLM Usage Ledger & Credit Accounting
Single source of "how much did this tenant spend". Every real call = a row; "credits" = friendly display of real token/USD (no markup MVP).
Files: llm-usage.ts (recordGeminiCall, recordMediaCost, recordLlmUsage, usageTotals → mkt_llm_usage); credits.ts (TOKENS_PER_CREDIT 250, USD_PER_CREDIT $0.000625, creditsFromTokens/Usd); plan-estimate.ts (estimate before run for tier cards); spend-split.ts (charged vs absorbed); verify-credits.ts, verify-llm-usage.ts.
**PRICING ENGINE actually in `orchestration/executor/node-cost.ts`:** image billed AS output tokens — base gemini-2.5-flash-image $30/1M ≈1290 tok ≈$0.039 (`:38-41`), Pro gemini-3-pro-image $120/1M ≈$0.13 (`:45`); Veo VEO_PER_SEC_USD 0.05 → 8s≈$0.40 (old $0.20 flat undercounted 2×, `:97-99`); thinking tokens at OUTPUT rate (`:19-20,62`); longest-prefix match (`:48-52`); flat IMAGE_FLAT 0.04, TTS_FLAT 0.02 (`:90,103`).
Hidden: TOKENS_PER_CREDIT 250 = DISPLAY not price (`credits.ts:6`); USD_PER_CREDIT anchoring $0.04 img≈64cr next to 15k-tok run≈60cr (`:16-20`); metadata-miss warn (`llm-usage.ts:76-80`); credits from REAL USD not tokens+USD (avoid double-count media, `:148-152`); fallback pricing $2.00/1M no-history (`plan-estimate.ts:28`); spend-split: failed bill nothing, re-runs free, off-run free (`:5-13,26-37`), re-run clamped 0 on old tenants (`:87-94`).
Charges fire: copygen, intake (gemini-intake-provider, requirement-analyzer), product analysis+extract, research (agent-runners:286), chat (atria-brain, conversation-author, save-offer-author), email (email-agent:48), all media nodes (agent-runners:603-900).
**Risk HIGH** — money layer, double-count fix (workflow-run-repo:294-309), 3 views must agree.

## 3. src/video/ (4 files) — Video Generation Pipeline
Stills→animated video+voiceover.
Files: veo.ts (generate, VEO_MODEL_ID — ~8s mp4 image-to-video, FS-cached); stitch.ts (stitchClips ffmpeg concat no-reencode, muxAudio); tts.ts (Gemini TTS→WAV); ffmpeg-resolver.ts (ensureFfmpeg, ffmpegBin, FfmpegUnavailableError).
Depended by: executor runVideo/runVideoScript (agent-runners:799-931).
Hidden: **ffmpeg Windows 0xC0000142** scrubbed-PATH spawn dies AFTER ~$1 media spent → FFMPEG_PATH override + pre-flight (`ffmpeg-resolver.ts:1-6,44` decodes hex exit); runner calls ensureFfmpeg BEFORE paid (`agent-runners.ts:814`); **prepaid-balance 429 classification** per-min(retry)/per-day(terminal)/depleted-prepaid(terminal), only per-min backs off else throw (no silent truncation, `veo.ts:55-71,106-121`), backoff 25/50/75/75s outlasts 1-min window, max 4; generateAudio:false fallback silent-tier 400 retry (`:97-104`); RAI safety-filter names reason (`:151-157`); poll 8s 10-min timeout (`:23-24`); muxAudio never truncates video (apad+shortest, `stitch.ts:40-43`); **video length clamp 12-120s** in goal-spec.ts:77 (COST decision, 120s≈$6.60); TTS DEFAULT_VOICE 'Kore' 24kHz WAV (`tts.ts:16,28-44`); preflight success cached process-life, FAILURE not cached (`ffmpeg-resolver.ts:29-31`).
**Risk HIGH** — quota classification + pre-flight ordering + mux -shortest guard real money; content-hash cache replays finished shots free.

## 4. src/imagegen/ (2 files) — Image Generation (Nano Banana)
Base for text-free, Pro for on-frame text (esp VN diacritics).
Files: nano-banana.ts (generate, imageModelId, IMAGE_OUTPUT_DIR); verify-image-live.ts (~$0.06 smoke).
Hidden: **base MANGLES VN diacritics** ("Nắng Sớm"→"Nắng Sóm"), Pro renders but ~3× price, opt-in per text-image (`:22-29`, MODEL_BASE gemini-2.5-flash-image, MODEL_PRO gemini-3-pro-image); model part of cache key (`:56-62`); image billed as tokens reads real usageMetadata (`:45-54,109-112`); 429 quota classification same as Veo (`:98-100`); NANO_BANANA_API_KEY→GEMINI_API_KEY fallback (`:81`).
Depended by: storyboard, infographic, video-keyframe (agent-runners:33,605,685,806); local: AssetStore reads output dir; save-uploaded/reference-image write into IMAGE_OUTPUT_DIR.
**Risk MED** — base/Pro cache-key + text heuristic load-bearing for cost/quality.

## 5. src/agents/ (3 files, in subdirs) — Researcher & Publish-Timing
researcher/ = content_search node (grounded Google Search research); publish-timing/ = advisory best-time nudge.
Files: researcher/grounded-search.ts (groundedSearch); researcher/run-research.ts (runResearch, NEVER throws→knowledge-only fallback); publish-timing/suggest-time.ts (PURE, no LLM/DB/net).
Hidden: **grounded search cannot request JSON mime** (API rejects when google_search attached, plain text `:66-70`); grounding surcharge GROUNDING_SURCHARGE_USD 0.035 (`agent-runners.ts:57,291`), usage only on real path (`run-research.ts:12-14,68`); caps MAX_SOURCE_NOTES 8, MAX_SUMMARY_CHARS 4000 (`:29-30`); publish-timing hardcoded const map, unknown→generic never throws (`suggest-time.ts:29-38`), B2B vs consumer wording (`:40-41`).
**Risk LOW-MED** — never-throw + usage-only-on-real matter for cost.

## 6. src/agent/ (2 files) — Intake Provider
Master Agent intake: free text → structured draft campaign + post brief.
Files: intake-provider.ts (DeterministicAgentIntakeProvider — regex, no AI, reliable fallback); gemini-intake-provider.ts (AI, falls back to deterministic on error).
Hidden: confidence min(0.95, 0.35 + fields×0.08) (`:104`); multilingual VI/EN keywords (`:28-68`); schedule needs BOTH "tomorrow" AND time, server local tz (`:54-68`); Gemini always falls back + bills surface 'intake' (`gemini-intake-provider.ts:66-77`); draft only never publish/invent (`:39`); fixed template `branding-video-post` (`:107`).
**Risk LOW-MED** — deterministic fallback de-risks AI.

## 7. src/product-knowledge/ (4 files) — Uploaded Product Docs
Users upload material; Gemini multimodal → factual profile grounding downstream prompts.
Files: analyze-documents.ts (analyzeDocuments, extractDocumentText, SUPPORTED_MIME); analysis-prompt.ts ("never invent only extract"); save-reference-image.ts; verify-library.ts.
Hidden: DOCX excluded (`:19-25`); text truncated 200k chars, 120s timeout (`:63,129`); uses REAL usageMetadata "first real-token plumbing" (`:6-8`), char/4 fallback (`:81-92`); temp 0.2 analyze/0 extract (`:161,128`); surfaces product_analysis, doc_extract (`:170,133`); profile JSON merged read-modify-write not overwritten (`profile-facade.ts:110-128`); resolution post-linked > campaign-linked, FK set-null content survives (`verify-library.ts:50-64`).
**Risk MED** — grounds every downstream prompt.

## 8. src/analytics/ (5) + src/impact/ (3)
analytics = real social metrics (reach/impressions/engagement); impact = ROI report (real activity + labeled estimate).
analytics files: fb-insights.ts, ig-insights.ts, threads-insights.ts, x-insights.ts, insights-types.ts (mergeInsights null-aware).
impact files: impact-metrics.ts (metricsForCampaign/Period), value-model.ts (estimateValue, buildImpactReport, LABELED), verify-impact.ts.
Hidden: **Graph API all-or-nothing per call** — any invalid metric fails whole call, validity varies → minimal independent metric GROUPS degrade to null (`fb-insights.ts:2-9`); platform null gaps: FB withholds reach <100 followers, IG impressions deprecated 2024-07-02→views, Threads NO reach, X free omits impression_count rate-limit ~1/15min; field null only when NO platform measured (keeps labeled estimate not false 0, `insights-types.ts:2-4,17-19`); 30-min TTL cache MAX_POSTS 50; impact credits from REAL USD (media-USD double-count fixed 33d805b, `impact-metrics.ts:55-58`); leads attributed by product name no FK (`:88-89`); value model ALL estimates labeled from env baselines (AGENCY_DAY 500/HOURS_PER_POST 2/WORK_HOURS 8/FREELANCER 50/REACH 300, `value-model.ts:28-58`), savedUsd never negative; headline prefers measured reach→engagement→estimated (`:76-84`).
**Risk MED** analytics / **MED-HIGH** impact (credit basis MUST match Usage+wallet).

## 9. src/memory/ (2 files) — User Memory
Agent stops re-asking. RECALL: rank facts+library+brand vs message. CAPTURE: persist durable slots.
Files: user-memory.ts (recallForMessage, captureFromGoal); profile-facade.ts (getProfile/getProduct/remember, thin facade over User+ProductKnowledge NOT new store).
Hidden: **composite rank** score×10 + priority×4 + min(usedCount,10)×0.6 + recency×2 (`:33-36`); recency window 14 days (`:32`); keyword-first NO embeddings (YAGNI), core identity priority=1 (`:6,50-56`); tokens ≥3 chars unicode-aware (`:18-19`); top 8 lines cap 200 chars (`:39,72`); **language NOT captured** (per-turn derived, stale caused wrong-language bug `:104-107`); product=dedup key, best-effort Promise.allSettled (`:91,114`).
**Risk LOW-MED** — tunable heuristics.

## 10. src/assets/ (4 files) — Asset Store & local: scheme
Abstracts WHERE media lives (Drive fileId or local file); gives public URL + raw bytes.
Files: store.ts (assetStore, DriveAssetStore, AssetRef, local: scheme); materialize.ts (materializeForPublicUrl, NEEDS_PUBLIC_URL, slugify); drive-client.ts (uploadImageToDrive, hasDriveConnected, driveAuthUrl, exchangeDriveCode); save-uploaded-image.ts.
Hidden: **local:<abs-path>** in-process file; fetchBinary works (FB/LinkedIn/X), **publicUrl THROWS for local** → IG/Threads need Drive id (`store.ts:6-11,40-44`); **lh3 video trap** — VIDEO fileId returns JPEG thumbnail not mp4, never publicUrl for video (`:36-38`); HTML interstitial guard — Drive serves HTML for large/flagged, rejected loud (`:62-66`); publish ORDER = array order not completion, 0-padded index prefix (`materialize.ts:8-11,44-46`); NEEDS_PUBLIC_URL {instagram, threads} (`:20`); Drive `drive.file` scope, one connect = drive.file+gmail.send+gmail.readonly (`drive-client.ts:9-11,118-135`), folder cache (`:38-64`), images anyone-with-link readable for Meta (`:96-97`); content-addressed hash dedup (`save-uploaded-image.ts:26`).
**Risk MED** — local:/Drive split wired into publish path; designed for clean S3 swap.

## 11. src/email/ (2 files) — Nurture Email
Drafts personalized nurture email (user reviews+sends, no blast), sends FROM owner Gmail.
Files: email-agent.ts (draftNurtureEmail, EmailDraft); gmail-send.ts (sendGmailAs, buildRaw, hasGmailConnected).
Hidden: human gate no-blast (`:1-3`); subject≤120 (fallback "Following up"), body≤4000 ≤120 words, one CTA, no HTML (`:14,31-36`); **every send own RFC 5322 Message-ID** `<uuid@mktagent.local>` for threading (`gmail-send.ts:7-13,97`); UTF-8 subject (`:28-29`); nurture unsubscribe footer + List-Unsubscribe header scoped nurture only (`:16-24,98-105`); scope failure "reconnect Google" (`:46-50,111-113`); never throws (`:54-55`).
**Risk LOW-MED** — threading + never-throw load-bearing.

## 12. src/scheduler/ (13 files) — Cron Ticks & Reapers
Always-on fleet: publish scheduled posts, resume due runs, self-heal crashed rows, calendar timings.
Files: tick.ts (runSchedulerTick, processPost, publishPostNow); reaper.ts (runReaperOnce); reaper-cron.ts (5min :03); cron.ts (startSchedulerCron 1min + startSchedulerResumeCron); resume-due-runs.ts (runResumeDueTick generic re-enter); lock.ts (acquireAdvisoryLock/acquireSchedulerLock pg session lock); resolve-input.ts (resolvePlatformInput, publishAssetType, distinctAssetTypes); aggregate.ts (per-platform→terminal status); schedule-calendar.ts (day-offsets→timestamps); cli.ts; verify-per-platform-publish/reaper/scheduler-safe-path.ts.
Hidden: cron flags OFF default (`env.ts:35-113`, mounted if enabled `server.ts:198-206`); cadences publish 1min (`cron.ts:9`), resume 1min own lock, reaper 5min :03 dodge stampede, autonomy 2min :01; **two-guard concurrency** advisory lock + atomic claimForPublish (`tick.ts:6-8`); **session lock MUST use own pg.Client** not pooled Prisma or unlock silent no-op + leak, crash auto-releases (`lock.ts:6-16`); distinct lock keys publish/copygen/resume never block (`:29-31`); isPublishBlocked delays post whose run producing OR parked (never publish before media, `tick.ts:14-16,210-218`); batch skips flow-active (`:199-244`); one publish/tick anti-burst; **auto-degrade** carousel/video→image on image-only IG/Threads never regenerate (`resolve-input.ts:26-39,58-66`); aggregate all-ok→posted/some→partial/none→error, degraded demotes posted→partial (`aggregate.ts:1-6,24-28`).
**Reapers (env-tunable):** POSTING 10min→error, RUN 20min→failed, NODE 10min→failed+cascade, **VIDEO_NODE 30min** bigger (Veo minutes×N, `reaper.ts:42-45`), ORPHAN_TTL 7d SURFACED not deleted (`:71-78`); every write guarded on stuck-state + idempotent, one failure never aborts sweep (`:6-8`).
**Calendar:** tz math no date-lib via Intl offset (`schedule-calendar.ts:6-8,39-56`); default window 09:00-11:00, deterministic jitter index×37%span, startDayOffset 1 (tomorrow never past), push past-due up to 400 days (`:28,76-88`).
**Risk HIGH** — advisory-lock-on-dedicated-connection, two-guard claim, isPublishBlocked, reaper guard-on-stuck, video bigger budget prevent double-publish/starvation/false-reap.

## Data flows
**(a) Media gen:** concept/plan LLM (runInfographic/Storyboard/VideoScript, recorded surface infographic/storyboard/video_script) → media gen (infographic 1 image Pro-if-text; storyboard N frames first anchors rest; video per-shot keyframe→Veo→stitch→TTS+mux, ffmpeg pre-flight FIRST) → cost ledger per physical call guarded !cached → attach local:<path> as post hero (Post = SoT) → scheduler publishes later (materialize local:→Drive for IG/Threads).
**(b) Cron exec:** publish tick (lock→findPublishDueBatch→skip flow-active/blocked→claimForPublish→processPost→resolve+materialize→fanout→aggregate→writeback→audit); resume-due (lock→claimScheduledDue→re-enter at pre-authorized action waive gate); reaper (posts posting→error, nodes running→failed+cascade video-aware, runs running→failed, orphans surfaced); autonomy kickoff (claims+executes granted-unstarted); nurture crons (behind flags, impl in src/nurture).

## Cost/credits summary
mkt_llm_usage (append-only per real call owner/surface/model + real tokens + costUsd → Usage + Impact). mkt_credit_ledger (append-only wallet balance=SUM(delta), TRIAL 2000, reconcileRunDebit positive-delta-only per-runId advisory-xact-lock). Debited: workflow-executor:114-123/:534 (finally) + copygen/service:186-193 (refine). Basis = wf_node_run.cost_usd via runCredits. Two ledgers diverge = re-run spend (absorbed). Double-count fix workflow-run-repo:294-309 (USD only, over-billed pure-LLM 2.4-2.8×).

## UNCLEAR / flagged
- src/agents/ empty at top (files in researcher/ + publish-timing/).
- Video length clamp 12-120s in goal-spec.ts:77 NOT src/video/ (video module snaps to 4/6/8s agent-runners:740-744).
- Pricing engine node-cost.ts in orchestration/executor/ NOT src/cost/.
- **`mediaCredit` query computed but appears UNUSED** in impact-metrics.ts:86/:125 (comment says basis is agg._sum.costUsd) — possible dead binding, flag for maintainer.
