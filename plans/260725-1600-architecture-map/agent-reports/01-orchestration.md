# Raw agent report — Orchestration subsystem (Agent 1)

> Raw output from the read-only explore agent. Feeds ARCHITECTURE_MAP.md §2, §3, §4, §5, §6, §7.
> `src/orchestration/` (106 TS files) — Atria's brain + workflow engine.

**One paragraph:** User chats; Atria's "brain" (atria/) reasons like ChatGPT, calls propose_workflow only when needed → "master" planning layer (master/) turns text→GoalSpec, decides clarifications, composes a DAG from a closed agent registry (registry/). Executor (executor/) runs the DAG node-by-node, pausing at approval/cost/schedule gates, spending real money, publishing. Schemas (schemas/) = typed contracts; prompts (prompts/) = LLM instructions; verify-*.ts = test suite (scripts, not framework).

## 1. atria/ — brain loop, tools, cache
### atria-brain.ts (324) — reasoning loop for one chat turn. Returns reply (default) OR proposal.
Exports: runAtriaBrain(input):AtriaTurn, legacyFallback (no-key→deterministic planner), gracefulReply (apology).
Depends: atria-tools, atria-brain-cache, prompts/atria-brain-prompt, master/master-agent, master/detect-language, thinking-budget, cost/llm-usage, logger. **Called by:** orchestration-router:314 (single caller, POST /runs).
Hidden: MAX_ROUNDS 3, TURN_BUDGET_MS 45000, CALL_TIMEOUT_MS 30000 (`:54-56`); **empty-content STOP bug** gemini-2.5-flash w/tools returns finishReason=STOP empty parts, explicit thinkingBudget fixes (`:83-89`, BUG-4 `:220-221`); **text-emitted tool call F18** model writes tool_code/print(default_api) as TEXT, detected+re-prompted (`:67-71,255-285`); schedule rescue if set_schedule parsed but no propose_workflow (`:243-253`); **reply-language pin** memory/instructions VN, model drifts, hard SEPARATOR "BACKGROUND ONLY" + last-position directive (`:190-203`) + no-LLM self-check logs atria_reply_language_mismatch (`:293-295`); runtime fault→APOLOGY never marketing plan, only missing key→deterministic (`:9-10,125-154`), degraded:true marks non-answers; S9 multi-turn recipient carry (`:173-179`).
**Risk HIGH** — central, stateful, many buried workarounds, whole product depends. Loop has NO direct verify.

### atria-tools.ts (485) — closed tool menu + dispatcher. Where reasoning→action.
Exports: TOOL_DECLARATIONS, dispatchTool, rescueScheduleProposal, ToolContext.
Depends: requirement-analyzer, deterministic-analyzer, master-agent, goal-merge, detect-language, parse-schedule-time, goal-spec, grounded-search, report-answer, user-memory, user-memory-repo, roadmap-demand-repo, lead-repo, cost/llm-usage. **Called by:** atria-brain, atria-brain-cache (TOOL_DECLARATIONS for hash).
Hidden (densest file): TASK_CAPABILITIES={summarize:'summary'} ONLY non-marketing capability (`:53`); **propose_workflow giant fn** (`:290-425`): capability-task branch; **LLM-authoritative removals** + raw-message re-analysis when paraphrased (`:333-345`); **kind forcing** BRAIN declares email-vs-marketing, regex must NOT (`:346-360`); **platform recovery** union parsePlatforms(ctx.message) minus dropPlatforms (F19 guard `:361-378`); kind-switch fresh vs additive merge (`:379-388`); schedule confirm re-parse same instant→confirmed (`:398-410`); lead recipient from RECORD not model (`:418-421`); email masking (`:63-69`); find_lead keeps authoritative address server-side (`:258-267`); rescueScheduleProposal sanctioned regex fallback Track A only when brain produced nothing (`:463-485`).
**Risk HIGH** — enormous branching, F10/F15/F18/F19/BUG-1 fixes, tight master coupling.

### atria-brain-cache.ts (68) — caches static prompt+tools prefix at Gemini for cheaper cached rate. TTL 3600, REFRESH_MARGIN 5min early-expiry (`:15-16`), content hash auto-invalidates (`:24-30`), best-effort→null→inline. Risk LOW.

### Peripheral atria (feed Command-Center surfaces NOT the DAG):
- atria-suggestions.ts (101) — deterministic signals→ranked nudges. ONE_OFF_MIN 3/LEADS_MIN 5/LEAD_SPIKE 3/EDIT_RATIO 0.5/EDIT_COUNT 3 (`:24-28`). Called by atria-router. LOW.
- signal-reader.ts (106) — derives signals from Prisma. LOW.
- memory-agent.ts (~96) — "learns your style" edits→style rules source:'memory'. MIN_EDITS 3/MAX_SAMPLES 15/MAX_PROPOSALS 3. Targets concept_writer. Called by memory-router. LOW-MED.
- workspace-report.ts (98) — "what happened" snapshot for campaign-scope. MAX_CAMPAIGNS 5/MAX_POST_TITLES 3. Consumed by conversation-author. LOW.
- parse-schedule-time.ts (53) — Gemini NL-time→UTC instant+IANA. morning≈08/afternoon≈14/evening≈19/night≈20, unknown tz→Asia/Bangkok (`:22-23`), strictly-future or null. Called by atria-tools. MED (tz edges).

## 2. master/ — planning brain
### master-agent.ts (64) — orchestrator façade analyze→clarify→plan. masterAgent.planFromGoal/handle/refine. MasterAgentOutcome (awaiting_clarification|planned|plan_error). opts.autonomous relaxes questions, opts.skipClarification for task goals (`:25-33`). Risk MED (hub).

### requirement-analyzer.ts (176) — free text→GoalSpec via Gemini, deterministic fallback, always Zod-valid. analyze/analyzeWithRemovals. Hidden: **video-length clamp 12-120s BEFORE Zod** (`:37-45,121-126`); **removals LLM-AUTHORITATIVE Phase 2**, model removals win when present, parseRemovals FALLBACK-ONLY never unioned (union re-introduced "publish without review" false-positive `:129-140`); platforms + @-recipient two FACT exceptions still unioned minus dropPlatforms (`:147-167`). **Risk HIGH**.

### deterministic-analyzer.ts (361) — no-LLM fallback regex extractor. analyzeDeterministic + parsePlatforms/parseEmailIntent/emailOutputs/parseRemovals/parseAccountType. Hidden: bare `short` was costly false-positive (Veo for text post), only shorts/youtube-short now (`:54-60`); video clamp 12-120 (`:63-81`); **"verb-near-target window ~24 chars"** false-removal fix nearVerb (`:295-322`); unicode wordRe (JS \b ASCII-only can't bound VN diacritics `:275-278`); campaign default 4wk×3, spotlight 1wk×5 (`:152-162`); storyboard/video independence VIDEO_WORDS shared (`:56-59,247`). **Risk HIGH** — enormous regex, VN/EN, many past bugs.

### workflow-planner.ts (216) — rule-based agent selection + DAG. **LOCKED: rule-based NOT LLM.** planWorkflow. PIPELINE_ORDER canonical (`:23-27`), edges DERIVED requires↔produces; backward-chaining selectByTargets (`:93-105`); targetsFromGoal ONLY place flags→targets (`:32-87`); publish-only guard actionable error (`:109-116,172-174`); **scheduler splices on PARSED .at NOT .confirmed** (`:153-167,192-203`). Risk MED (well-covered by verify-planner-golden).

### goal-merge.ts (176) — additive merge delta onto prior + subtractive applyRemovals. Makes conversation cumulative. mergeGoals/applyRemovals. Hidden: **F19 memory-bleed guard** delta names platforms REPLACES prior, mergeScope (`:45-72`); productDetails ACCUMULATES not fillIfEmpty (`:36-43`); needsEmail/emailTo/leadId/schedule/sourceText/taskTargets/qualityPref must survive bare confirm (`:95-133`); empty-plan guard→text post (`:165-173`). **Risk HIGH** — every field a landmine, core to multi-turn.

### clarification-engine.ts (227) — pure/deterministic decides plan vs ask. evaluateClarification. MAX_QUESTIONS 5, RICHNESS_THRESHOLD 2 (`:25-28`); placeholder-product regexes (`:34-51`); thin-product ≥12char/depth-probe 12-40char (`:47-51,124-139`); email needs ONLY recipient (`:81-90`); AUTONOMY_HARD_SLOTS {product,productDetails,output_format} (`:61`); **"never silently default platforms"** (`:181-189`); accountType/audience/angle NEVER blockers (`:196-212`). **Risk MED-HIGH**.

### conversation-author.ts (219) — outcome→human reply, Gemini + deterministic fallback. conversationAuthor/deterministicReply. **Schedule confirm-ask DETERMINISTIC** localized SCHEDULE_TAIL vi/id/ko/en else English (F11 `:106-132,208-212`); reply language mirrors CURRENT message not persisted slots.language (`:46-53`). Risk MED.

### detect-language.ts (144) — backup detector + contentLanguageFor chain. detectLanguage/languageName/contentLanguageFor/replyLanguageHint/looksVietnamese. Latin excluded→null (`:12-25`); VN false-positive fixes distinctive diacritics + lowercase-only tokens + ≥2 unaccented function words (`:36-67`); contentLanguageFor: prior→declaration→detection→English (`:96-110`). Risk MED (dependency-free).

### campaign-* cluster (scope→calendar→materialize):
- campaign-intent.ts (117) — after flow SAVED routes create/plan/ambiguous. Bug 2026-07-13 bare cadence hijacked create, STRONG_BATCH_RE requires cadence+content-noun (`:36-49`). Called by orchestration-router. MED.
- campaign-from-flow.ts (79) — Campaign(+first Post) from saved template, clones DAG, per-message platform override. MED.
- campaign-materializer.ts (103) — approved calendar→N scheduled Posts, each own run. **Idempotent** sweeps first, failed slot SKIPPED not fatal. Called by orchestration-router + campaigns-router. MED-HIGH (real scheduled posts).
- campaign-grant.ts (70) — cost estimate + rollup for grant handshake. LOW.

### master utility/glue:
- artifact-graph.ts (28) — reverse index artifact→producer, **asserts single producer per type at LOAD** (two→throws). Consumed by workflow-planner. LOW.
- workflow-validator.ts (70) — Kahn topo + input-satisfiability, returns errors not throws. LOW-MED.
- plan-tiers.ts (61) — Economy/Balanced/Full variants→3 cards, dedups. LOW.
- llm-json.ts (67) — generic text→JSON Gemini for runners, injectable DRY, per-node thinkingBudget, temp 0.6. Consumed everywhere. MED.
- report-answer.ts (31) — workspace metrics for get_workspace_data tool, no LLM, default 30d. LOW.
- **intent-router.ts (36) — legacy P1 regex classifier classifyIntent, superseded by brain. Purpose UNCLEAR/likely DEAD (no importers).**

## 3. executor/ — running the DAG
### workflow-executor.ts (537) — SINGLE MOST COMPLEX FILE. Runs/resumes DAG in dep order, halts at gates, spends money, publishes. Resumable.
runWorkflow(runId,ownerId,goal,plan,opts). Depends: workflow-validator, agent-registry, agent-executor, approval-policy, node-cost, agent-runners, artifact-store + MANY outside (workflow-run-repo, credit-repo, post-repo, scheduler/resolve-input, connection-resolver, events/bus, publish-timing, social/postability). **Called by:** orchestration-router (launch), autonomy-runner, scheduler/resume-due-runs (3 entry points, different ExecuteOptions).
Hidden: **credit reconcile in finally** every exit, FAILED never charged (2026-07-15 `:103-128,533-534`); **media gating MEDIA_AGENT_ASSET** skip+never-pay unneeded step, storyboard serves carousel+video (`:47-55,317-325`); gate model from registry gate:'selection'|'cost'|'publish'|'schedule' (`:62,160`); Atria autonomy clears own gates when guardrails hold else park+notify (`:162-166,244-250,443-460`); **BUG-3 gate-after-content** connection gate DEFERRED to publish boundary (draft reviewable pre-connect `:348-371`); H1a approveOrThrow fail loud if review→ready no-ops (`:235-240`); **schedule gate preserves scheduledAt** raw new Date() clobbers→cron due now (`:187-194,405-441`); auto-publish waiver default OFF, suppressed when video cost gate exists (`:378-404`); rerunOnly parks at planned not needs_approval (`:258-288`). **Risk HIGH**.

### agent-runners.ts (1421) — BIGGEST FILE. Maps agentId→artifact-producing fn — ONLY place orchestration touches live runtime.
getRunner(agentId), RunnerContext, RunnerOutput, 19 run* functions. Huge fan-out: copygen, imagegen, video, scheduler/tick, email/gmail-send, messaging/dm-runners, social/greeting, researcher, publish-timing, leads/scoring, nurture, connectors, many db repos, llm-json, detect-language, build-agent-prompt, resolve-instructions, node-cost. **Called by:** agent-executor.
Hidden (dozens): GROUNDING_SURCHARGE 0.035 (`:57`); concept_writer vs copy-gen boundary two layers separate (`:117-127`); edit-loss fix preserves user copy on re-run (`:169-215`); refuses re-run on published (B-F8/H2 `:200-207`); **Pro-image F1** base corrupts VN diacritics, KEYFRAME_TEXT_RE→Pro (`:578-584,607-608`); video_script normalization renumber/recompute/snap 4/6/8s/trim MIDDLE keep hook+CTA (`:739-793`); **ffmpeg pre-flight F21** before paid (`:809-814`); terminal-quota vs flaky-shot (image 200-no-image ~1/3 skip+count, terminal fails loud cache-replay note `:861-882`); **security node fail-CLOSED per window** masks WHOLE doc 40k windows refuses raw on mask fail (`:1029-1129`), summarize map-reduce 20k (`:1131-1192`); email language authority lead in THEIR language (F13 `:984-1002`), nurture reply seed VERBATIM (`:952-961`); opt-out gate absolute+global email_agent (`:1203-1211`); idempotency via audit log greeting_agent (`:1345-1367`). **Risk HIGH** — densest bug-workaround concentration.

### agent-executor.ts (41) — runs ONE node: pick runner, bind budget, execute, validate-out, persist. Budget binding ONLY when llmJsonFn unset (DRY stub not overridden `:27-34`). LOW.
### node-cost.ts (113) — per-node accounting, prefers real usageMetadata. PRICING 2026-07, longest-prefix (`:32-53`), thinking at output rate, VEO_PER_SEC 0.05, IMAGE_FLAT 0.04, TTS_FLAT 0.02 (`:89-104`). LOW-MED.
### approval-policy.ts (86) + .verify.ts — Atria autonomous approval, fail-closed pure. cost gate holds if budgetUsd===null (never blind-spend), **schedule gate ALWAYS holds** even granted (`:36-60`). LOW.
### artifact-store.ts (82) — typed outputs stored once, validated against Zod BEFORE insert. putArtifact/updateArtifactData/getArtifact/listArtifacts/deleteArtifactsByNodes. LOW-MED.

## 4. schemas/
- **goal-spec.ts (195)** — structured intent, GoalSpec Zod = single source of truth. videoLengthSec 12-120 COST decision (120s≈$6.60 `:73-77`); videoTarget NOT platforms entry (publisher fails "no target" `:62-66`); assetTypeFromOutputs ONE rule plan→deliverable; text-only default fixes "no asset(image)" (`:124-133`); schedule.confirmed gates scheduler. **Risk HIGH by blast-radius.**
- workflow-plan.ts (53) — DAG. runnableAgentId enum, workflowNode/Plan/PlanResult/agentIdList. MED.
- artifact-schemas.ts (348) — closed set 18 artifact types + artifactSchemaFor. Many optional for back-compat (degraded/shotCount/brief/aspectRatio). MED.

## 5. registry/
- **agent-registry.ts (514)** — AGENTS array = closed capability menu (19 runnable). **CRITICAL: planner may ONLY choose from here.** requires/optional/produces (edges derived), gate, requiresApproval, promptSections. getAgent/agentGate/hasGate. Role-boundary notes (infographic=overview vs storyboard=detail; video consumes video_script not storyboard). **Risk MED-HIGH** (single source of what system can do).
- agent-types.ts (111) LOW-MED; agent-groups.ts (33, display taxonomy) LOW; roadmap-agents.ts (34, pitched-not-runnable) LOW; vision-agents.ts (85, DISPLAY-ONLY roster separate from AGENTS so planner never sees, some implStatus:'live') LOW.

## 6. prompts/
- atria-brain-prompt.ts (43) — brain system prompt (persona+tools+language/honesty/scheduling). LOAD-BEARING PROSE. Cached. MED.
- requirement-prompt.ts (60) — intent→JSON prompt + removal/platform/scope rules (LLM side of regex→LLM migration). MED.
- conversation-prompt.ts (69) — outcome-voicer. LOW-MED.
- build-agent-prompt.ts (66) — COMPOSITION POINT: expert base→language→instructions→output contract (contract LAST wins). MED.
- agent-prompts.ts (150) — per-agent JSON AGENT_OUTPUT_CONTRACTS (7 keys incl storyboard's 2 variants). MED.
- resolve-instructions.ts (65) — layered instructions workspace→campaign→post, general→agent-specific, resolveWorkspaceInstructionsBlock MARKETING-ONLY caveat. LOW-MED.

## 7. verify-*.ts — test coverage map (~45 scripts, tiers: pure/DB/DRY-RUN/live-HTTP)
Planner/analyzer: verify-planner, verify-planner-golden (GOLDEN safety net for selectAgents refactor), verify-master, verify-campaign-intent, verify-plan-tiers, verify-summarize-node, verify-storyboard-video-dep, verify-video-script. Executor/gates: verify-executor, verify-concept-gate, verify-rerun-node, verify-rerun-race, verify-scheduler-node, verify-connection-resolver, verify-connection-hardening, approval-policy.verify, verify-edit-loss, verify-publish-timing, verify-image-quality-routing, verify-ffmpeg-preflight, verify-token-force-refresh. Campaign: verify-campaign-strategist/materializer/grant/reuse-http/platform-inherit-http. Atria: verify-atria-suggestions, verify-capability-gap, verify-nurture-email-from-chat, verify-memory-agent, verify-instructions(-and-memory), verify-agent-prompts, verify-thinking-budget. Email/DM/media: verify-email-node/agent, verify-*-insights, verify-researcher. Persistence: verify-persistence, verify-template-instance, verify-flow-cost-rollup, verify-workspace-view, verify-save-offer(-http), verify-rename-and-creds, verify-api. Support: testing/stub-llm-json.ts (DRY stub dispatches by prompt phrase), testing/intent-corpus.ts (adversarial FALSE-REMOVAL/FACT for regex→LLM).
**Coverage gap:** runAtriaBrain loop NO direct verify (only tools). intent-router classifyIntent dead. demo-chat.ts manual demo not test.

## 8. Data flows
**(a) chat→propose→plan→execute:** orchestration-router POST /runs → ensureChatSession + saved-flow(campaign-intent)/refine-shortcut → recallForMessage + resolveWorkspaceInstructionsBlock + getChatHistory → runAtriaBrain (loop: callGemini cached → dispatchTool → propose_workflow → requirementAnalyzer.analyzeWithRemovals + mergeGoals+applyRemovals + kind/platform/schedule/lead overlays → masterAgent.planFromGoal → evaluateClarification → planWorkflow (targetsFromGoal→selectByTargets via producerOf→deriveDeps→scheduler splice→workflowPlan.parse→validatePlan) → outcome) → AtriaTurn proposal → applyOutcomeToRun + recordTurn (conversationAuthor voices) → [approve] → executePlannedRun→launchWorkflow→runWorkflow (validatePlan→topo→per node executeNode→getRunner→artifact→putArtifact→gates→reconcileCredits finally).
**(b) campaign→strategist→calendar→materialize:** multi-post intent→scope campaign/spotlight→planWorkflow targets [campaign_ideas,strategy_brief,content_calendar,+research]→DAG content_search?→ideation→strategy→campaign_strategist STOPS→runWorkflow strategist produces content_calendar→parks gate='selection'→[edit+approve]→campaigns-router POST /:id/materialize→materializeCalendar (sweep+scheduleCalendar per-slot scheduledAt, per slot goalForSlot single-scope→planWorkflow→createRun+Nodes+Post)→[grant]→autonomy-runner→scheduler/tick publishes each at scheduledAt.

## 9. Circular / hidden deps
- **master/ ↔ atria/ two-way coupling** (structural not TS cycle): atria-tools imports FROM master/* (requirement-analyzer, deterministic-analyzer, master-agent, goal-merge, detect-language) + atria-brain imports master/master-agent + conversation-author; meanwhile atria-tools imports master/report-answer. **master is NOT a clean lower layer — atria + master are PEERS.** A refactor assuming "atria above master" hits this.
- registry/agent-registry LOAD-TIME assertion via master/artifact-graph (two producers→throws anywhere in import chain).
- atria-brain-cache→atria-tools (TOOL_DECLARATIONS) + atria-brain→both — triangle, tool schema change silently invalidates cache by hash.
- **agent-runners.ts = HUB with ~40 outbound imports** crossing nearly every subsystem — widest coupling point, integration seam orchestration↔everything.
- Executor↔scheduler↔autonomy triangle: workflow-executor called by orchestration-router + autonomy-runner + scheduler/resume-due-runs (3 entry, different ExecuteOptions) — any executor change must satisfy all three.

## 10. UNCLEAR / potentially dead
- **master/intent-router.ts (classifyIntent)** — "P1 scope, P2 upgrades to LLM"; brain IS P2 replacement. No importers (grep only own def). **Very likely dead — confirm+delete.**
- orchestration/demo-chat.ts — throwaway manual demo hits /agent/intake (OLD) vs /orchestration (NEW); comment says new backbone "not yet wired to UI" now FALSE. Stale.
- registry/vision-agents.ts vs roadmap-agents.ts — overlapping "future agents" (both list email/memory/analytics), two sources of truth for "planned agents".
- atria-suggestions/signal-reader/memory-agent/workspace-report — purposeful but MIS-FILED under atria/ (feed CC surfaces not brain loop); refactor might move to command-center/.

## 11. Risk summary
| Risk | Files |
|---|---|
| HIGH | atria-brain, atria-tools, requirement-analyzer, deterministic-analyzer, goal-merge, workflow-executor, agent-runners, goal-spec (blast radius) |
| MED-HIGH | clarification-engine, agent-registry, campaign-materializer |
| MED | master-agent, workflow-planner, conversation-author, detect-language, campaign-intent, campaign-from-flow, llm-json, parse-schedule-time, artifact-schemas, workflow-plan, node-cost, artifact-store, prompt files, build-agent-prompt, agent-prompts |
| LOW | atria-brain-cache, atria-suggestions, signal-reader, workspace-report, report-answer, artifact-graph, workflow-validator, plan-tiers, approval-policy, agent-executor, campaign-grant, agent-types, agent-groups, roadmap-agents, vision-agents, resolve-instructions, thinking-budget, autonomy/* |

**Cross-cutting refactor hazards:**
1. "LLM-authoritative vs regex fallback" spread across requirement-analyzer/deterministic-analyzer/atria-tools/detect-language/goal-merge — changing one half without other reintroduces F19/false-removal/memory-bleed/language-bleed.
2. goal-spec.ts = universal contract — touch it, every layer shifts.
3. Gate semantics split between registry (gate field) + executor interpretation — keep together.
4. verify-planner-golden.ts = explicit safety net for planner refactor — run first.

## Open questions (§7)
1. master/intent-router.ts (classifyIntent) truly dead? (No importers.)
2. testing/intent-corpus.ts references verify-intent-corpus.ts consumer that doesn't exist — was it removed, corpus half-orphaned (only verify-master imports)?
3. Re-scope atria Command-Center files (suggestions/signal-reader/memory-agent/workspace-report) out of atria/?
4. demo-chat.ts — keep as manual smoke or retire (premise stale)?
