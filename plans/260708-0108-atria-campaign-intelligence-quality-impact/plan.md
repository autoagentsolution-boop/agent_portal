# Atria: Campaign Intelligence + Content Quality + Impact — Plan (v1)

Turn Atria from a single-post generator into a **proactive campaign strategist** whose content is
**expert-grade + on the user's own brand instructions**, and that **proves its value** back to the user
(reach/leads/cost-saved). Supersedes the campaign-only draft (260708-0033) — folds it in + adds the
Content-Quality and Impact tracks the user asked for.

## Decisions (locked 2026-07-08 with user)
1. First slice = campaign planner + proactive suggestion (Pillar 1 + thin Pillar 3).
2. Boldness = suggest → user reviews/edits → double-confirm grant → runs autonomously. Nothing unasked.
3. Capability gaps = Atria PITCHES roadmap agents (Email/Analytics/Memory) + logs demand.
4. **[NEW] Content quality is prompt-bound** → make built-in prompts expert-grade AND let USERS embed
   their own instructions (ChatGPT-style), layered into EVERY agent, so content gets better + on-brand.
5. **[NEW] Prove the value** → a per-campaign/period Impact report: cost spent + cost SAVED vs a market
   baseline + output volume + time saved + leads captured (reach as a labeled estimate until v2 metrics).
6. Reuse the hardened foundation (autonomy-hardening: safe scheduler, grant seam, reapers). Additive.

## Current state (scouted 2026-07-08 — grounds every phase)
- Prompts: `orchestration/prompts/*.ts` (155 lines) are terse "you are X, return JSON" — no expert
  persona/frameworks/examples; hardcoded. Registry `promptSections` (role/goal/caps/constraints)
  scaffolded but UNUSED. `brandVoice` injected into COPY only (copygen/prompt.ts), one thin string.
- Planner is registry-driven (fresh DAG per goal, no template lock) but rule-based over output-flags.
- `strategy` agent emits pillars/positioning/funnel — per single post only. Campaign owns N posts;
  `postingWindow`+`timezone` EXIST but DORMANT. `memory/profile-facade.ts` = anticipation seed.
- Cost = REAL (`mkt_llm_usage` ledger + credits). Leads = REAL (`mkt_lead` per campaign). Reach/views =
  NOT captured (needs platform Insights → v2). Master-agent purely reactive (no suggestion path).

## Phases (implement in order)
- **phase-01-structured-expert-prompts.md** — one prompt builder consuming registry `promptSections`;
  rewrite agent prompts to expert-grade (persona + marketing frameworks + quality bars). FOUNDATION.
- **phase-02-user-instruction-system.md** — layered user "Atria Instructions" (Workspace→Campaign→Post
  →Agent), ChatGPT-style, injected into EVERY agent via the Phase-01 builder. On-brand + better content.
- **phase-03-campaign-strategist.md** — campaign intent + `content_calendar` artifact + `campaign_strategist`
  Intelligence agent (research→strategy→editable N-slot calendar).
- **phase-04-calendar-materializer.md** — approved calendar → N scheduled Posts (per-slot DAG + real
  `scheduledAt`); activate the dormant `postingWindow` cadence engine.
- **phase-05-campaign-grant.md** — approve the calendar ONCE → all posts run autonomously; per-post
  guardrails + audit + notify (extends the autonomy-hardening grant to a whole campaign).
- **phase-06-proactive-suggestion.md** — no-PII heuristic suggestion engine + agent-roadmap pitch +
  demand log. The WOW. Suggest→confirm→run, never auto-act.
- **phase-07-impact-report.md** — value/ROI report: cost spent (real) + cost saved vs baseline + output
  volume + time saved + leads (real) + estimated reach. Per-campaign + per-period.
- **phase-08-ui-v2.md** — calendar review/edit + instruction editor + suggestion cards + campaign board +
  impact-report view. Frontend (surfaces phases 02–07).

## Sequencing / dependencies
01→02 (quality FIRST — lifts every downstream agent incl. the strategist) → 03→04→05 (campaign) → 06
(proactive) → 07 (impact; needs runs to report on) → 08 (UI; parallelizable once 01–07 backends stable).

## The Memory Agent thread (ties quality → proactivity → v2)
The user's "content gets better and better by learning me" IS the **Memory Agent's** job. v1 sets it up
without building it: Phase 02's instruction table carries a `source:'user'|'memory'` field so Memory can
later WRITE learned instructions the user reviews; Phase 06 PITCHES turning Memory on when the user keeps
re-editing content. So Memory is a roadmap agent Atria proactively sells, and the v2 learned-instruction +
anticipation engine — the manual instruction system is its scaffold.

## Out of scope (v1) — explicit
- Real platform reach/view metrics (needs Insights APIs) → Impact uses cost/leads/volume + estimated
  reach; real metrics = v2 Analytics agent.
- **The Memory Agent as a runner** (auto-refining instructions from results) — v1 gives the MECHANISM
  (expert bases + editable instructions + `source` field + the pitch); the learning loop is v2.
- Building roadmap agents as runners; capability/LLM-driven planner (Pillar 2); multi-product orchestration.

## Success criteria (v1)
- Content is visibly better + honors the user's own instructions across ALL agents (not just copy).
- One intent → research-backed editable calendar → one grant → N posts run autonomously, each guardrailed.
- Atria proactively proposes a campaign from observed history (no PII); pitches roadmap agents on gaps.
- After a campaign, the user sees a concrete Impact report: "$X + N credits vs ~$Y/2 months an agency;
  N posts, M platforms, K leads." — the retention/sales artifact.
