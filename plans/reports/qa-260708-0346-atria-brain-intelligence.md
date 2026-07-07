# QA Audit — Atria "the brain" (conversational intelligence + planning)

Read-only static audit. Scope A: does Atria reason well or is it a thin rule shell? Traced demo happy-path idea→strategy→posts.

**TL;DR:** Architecture is a sound LLM-extract / rule-plan HYBRID with a genuinely live multi-post strategist and real, explainable proactive suggestions. NOT a thin shell. BUT the whole campaign-intelligence path (strategist → calendar → materialize) is gated behind NARROW deterministic phrasing the LLM can never trigger — a natural "build me a branding campaign" yields a SINGLE post, not a calendar. That is the #1 demo trap.

---

## Q1 — Restate intent + high-impact clarifying Qs; language mirroring real or hardcoded?

**Verdict: ✅ matches design (with ⚠ no-API-key fallback)**

- Restate + prose questions: `conversation-prompt.ts:44-47` instructs "restate what you understood in ONE sentence, then ask the listed questions" as bullets, lead with required, user's language. Author voices structured outcome only, never plans (`conversation-author.ts:1-6`). ✅
- High-impact only, capped: `clarification-engine.ts:25` MAX_QUESTIONS=5; slots = product / productDetails / output_format / platforms / accountType / audience / angle, with required-ness tuned by a richness gate (`clarification-engine.ts:135-141`). Placeholder/thin-product gate (`:47-51`) stops the "sản phẩm của tôi" loop. Reasonable + high-impact. ✅
- Language mirroring is REAL any-language, NOT hardcoded vi/en: authoritative signal is the raw `userMessage` mirrored by the model (`conversation-author.ts:124-127`), with an optional script-detected code hint that only PINS when unambiguous (`:49-50`, `:120`). Directive "Write in the SAME language as the user's latest message… do not default to English" (`:127`). `detectLanguage` is a hint, not a vi/en binary. ✅

⚠ **No-key fallback leaks Vietnamese seeds.** When `GEMINI_API_KEY` absent, `deterministicReply` (`conversation-author.ts:84-109`) emits `q.question` verbatim — and three question seeds are hardcoded Vietnamese (`clarification-engine.ts:92, 110, 163`). An English demo user with no key would see raw Vietnamese questions. Fine IF the demo box has a key.

---

## Q2 — LLM-driven, rule-based, or hybrid? Sensible workflow? Any dumbness?

**Verdict: ⚠ partial — hybrid is sound, but campaign-scope gating is a trap**

- HYBRID, per locked decision: LLM extracts `GoalSpec` intent (`requirement-analyzer.ts:59-116`), rule engine selects agents + derives the DAG (`workflow-planner.ts:1-6, 19-52`), clarification is pure deterministic rules (`clarification-engine.ts:6-7`). Edges are DERIVED from each agent's `requires`/`produces`, not hand-authored (`workflow-planner.ts:54-75`). Clean, extensible. ✅
- Sensible single-scope flow: research?→ideation→strategy→concept_writer→(infographic/storyboard/video)→publisher (`workflow-planner.ts:34-51`). Good branding pipeline. ✅
- Deterministic fallback is a real regex brain (bilingual vi/en), Zod-valid output always (`deterministic-analyzer.ts:184-208`). ✅

⚠❌ **The dumbness / trap — campaignScope only escalates via narrow regex; the LLM can NEVER set it.** `requirement-prompt.ts` (the LLM intake prompt) NEVER mentions `campaignScope`/`duration`/`cadence` — so the LLM always returns scope=`single` (schema default `goal-spec.ts:78`). The merge only adopts a NON-single scope from the DETERMINISTIC parser (`requirement-analyzer.ts:108-111`), and that parser escalates ONLY on `CAMPAIGN_PLAN_RE` = "content calendar / plan a month / N posts a week / weekly content / lịch đăng…" or an explicit duration/cadence number (`deterministic-analyzer.ts:89-113`). Consequence: bare "campaign"/"branding" fires the rich SINGLE-post pipeline (`isCampaign`, `:79-80`) but NOT the multi-post strategist. A demo user typing **"Build a branding campaign for my coffee shop"** gets ONE post + calendar UI never appears. To reach the strategist they must literally say "plan a month" / "content calendar" / "3 posts a week". The entire Phase 03-05 campaign-intelligence feature is hidden behind phrasing the natural request won't hit.

---

## Q3 — Strategist: proactive multi-post plan or single posts? Real signals or stubbed?

**Verdict: ✅ strategist is real & genuinely multi-post — ⚠ reachability (see Q2)**

- LIVE, not stubbed: `runCampaignStrategist` (`agent-runners.ts:450-481`) makes a real Gemini JSON call, produces `content_calendar` of N≈cadence×duration slots (`:457-459`), validated by Zod (`:473-474`), bills usage (`:475`). Registry marks it `implStatus:'live'` with a real expert persona (pillar×funnel sequencing, `agent-registry.ts:87-118`).
- Grounded in REAL upstream signals: prompt is fed the live `strategy_brief` pillars + funnelStage and resolved product knowledge (`agent-runners.ts:461-469, 463`). Not canned.
- Proactive multi-post loop is real end-to-end: strategist parks at a `selection` gate (`agent-registry.ts:96-99`); user reviews/edits the N slots; `POST /runs/:id/materialize-calendar` creates a real Campaign + N scheduled Posts, each its own registry-composed flow (`orchestration-router.ts:360-391`, `campaign-materializer.ts:55-101`). Idempotent re-materialize sweeps un-published posts only (`:64`). ✅ This is genuine campaign planning, not a mock.
- Note: strategist is NOT fed `signal-reader` signals — correct; those drive suggestions (Q4), a separate surface.

---

## Q4 — Proactive suggestions / signal-reader / workspace-report: real or canned?

**Verdict: ✅ computed from real workspace state**

- `signal-reader.ts:71-82` reads real DB (campaigns, posts w/ status+copyEdited, lead count); `deriveSignals` is pure + testable (`:30-69`). Signals: top one-off product, edit ratio, completed campaigns, lead volume — all structural counts, no PII.
- `atria-suggestions.ts:29-79` maps signals→ranked nudges via named thresholds (`:24-27`), each with a SHOWN rationale quoting the real numbers ("You've made N one-off posts about X…"). Explainable rules, no ML, every nudge traces to a number. ✅
- Served live at `GET /atria/suggestions` (`atria-router.ts:21-34`); roadmap pitches logged once so Atria doesn't nag (`:28-29`). ✅
- `workspace-report.ts` is a real tenant-scoped DB snapshot of recent campaigns/posts (`:35-82`), bounded (5 campaigns, 3 titles), opens campaign-scope replies (`orchestration-chat.ts:61-63`). Facts-only, first-turn-only. ✅

Minor: rationale strings are templated (fine — grounded in real values, not fabricated).

---

## Demo-day risks (ranked)

1. **[HIGH] "Campaign" request yields a single post, not a calendar.** Natural branding phrasing ("make me a branding campaign", "campaign for X") does NOT escalate `campaignScope` — only literal "plan a month / content calendar / N posts a week" does (`deterministic-analyzer.ts:89-113`; LLM can't set it, `requirement-prompt.ts` omits scope). The flagship strategist/calendar simply never appears. Presenter must know the magic words.
2. **[MED] Materialized calendar can silently under-deliver.** A slot whose per-slot GoalSpec fails to plan is SKIPPED, not surfaced loudly (`campaign-materializer.ts:80-83`) — a "12-post month" could materialize 10 with the drop only in `result.skipped`. Live demo count mismatch risk.
3. **[MED] No-API-key box shows Vietnamese question text to non-VN users** (`conversation-author.ts:84-109` + hardcoded seeds `clarification-engine.ts:92,110,163`). Only bites if the demo env lacks `GEMINI_API_KEY`.
4. **[LOW] Greedy product parse in fallback.** `parseProduct` "for X" captures a long tail ("my coffee shop and grow sales"); only matters when the LLM is down (`deterministic-analyzer.ts:43-47`).
5. **[LOW] Workspace report never shows on single-post turns** (by design, `orchestration-chat.ts:61`) — the common demo path looks "blind" to existing campaigns. Acceptable but worth knowing.

---

## Tomorrow fix list

**P0**
- Make campaign intent reachable from natural language. Either (a) add `campaignScope`/`duration`/`cadence` to `requirement-prompt.ts` so the LLM can escalate, then union it in `requirement-analyzer.ts:108-111` (mirror the platform-union pattern), OR (b) broaden `CAMPAIGN_PLAN_RE`/`isCampaign` so "branding campaign" + "campaign for" escalate to `campaign` scope. Files: `orchestration/prompts/requirement-prompt.ts`, `master/requirement-analyzer.ts:108-111`, `master/deterministic-analyzer.ts:79-119`.

**P1**
- Surface materialize skips to the user (don't silently drop slots). Return/toast `result.skipped` and/or retry with a simpler plan. `campaign-materializer.ts:80-83`, `orchestration-router.ts:382-390`.
- Translate/neutralize the hardcoded VN question seeds for the no-key fallback path, or gate `deterministicReply` question text through a language-aware map. `clarification-engine.ts:92,110,163`, `conversation-author.ts:84-98`.

**P2**
- Consider showing a light workspace report on single-post campaign-ish turns too (currently campaign-scope only) so Atria never reads blind. `orchestration-chat.ts:61-63`.
- Tighten `parseProduct` tail capture in the deterministic fallback. `deterministic-analyzer.ts:43-47`.

---

## Unresolved questions

- Does the demo environment have `GEMINI_API_KEY` set? Risks #3 and #4 (and the VN-seed leak) only matter if it doesn't.
- Is the P0 campaign-scope narrowness intentional demo-scripting (presenter types exact phrases) or an oversight? Comments (`deterministic-analyzer.ts:86-88`) call it "deliberately NARROW", so a product decision may be needed, not just a code fix.
- UI side (out of my scope A): does the chat panel actually render the calendar selection gate + a "materialize" affordance after the strategist parks? Backend seam exists (`/runs/:id/materialize-calendar`); front-end wiring in `saved-flow-detail.tsx` was not audited here.
