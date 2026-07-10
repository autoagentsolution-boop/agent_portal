# Atria Core-Intelligence — reason like ChatGPT/Claude, not a marketing-DAG planner

Branch `pivot/video-content-farm` · 2026-07-10 · standalone plan (requested).
**Vision (user):** Atria is the CORE agent and the WOW — it must always rival ChatGPT/Claude. Today it
is a narrow *marketing-DAG planner*, can't answer questions, can't reason on general tasks, has no real
memory, and is hardwired to Gemini. This plan turns Atria into a genuine reasoning agent.

## Findings — why Atria feels dumb today (audited 2026-07-10)
1. **No reasoning/query layer.** `master-agent.ts handle()` = `analyze → clarify → planWorkflow`. EVERY
   message is forced into "extract a marketing GoalSpec → plan a content DAG." So "how are my campaigns
   going?" becomes a (nonsensical) content plan or resets to clarification. There is no branch to just
   *answer*.
2. **Marketing-framed everything.** concept_writer=marketing copy, ideation/strategy/campaign_strategist=
   funnel steps, vision agents (Analytics/Leads/Email/Memory)=marketing roles. A kids' vocab video still
   runs through "sell-a-brand" plumbing. (Clarification just relaxed — the planning framing remains.)
3. **Memory = per-conversation `mergeGoals` only.** No long-term, no semantic recall, no cross-session
   knowledge. The "Memory agent" learns copy STYLE, not facts/context.
4. **Gemini hardcoded in ~10 places** (`llm-json`, `conversation-author`, `copygen/gemini`, `nano-banana`,
   `voice-router`, `grounded-search`, `gemini-intake-provider`, `clarification-engine`). No provider
   abstraction → "not only Gemini" needs a real LLM layer.
5. **Assets that already exist to build on:** `metricsForPeriod`+`buildImpactReport` (Impact data, has a
   NL `headline`), `conversation-author` (authors replies, deterministic fallback), read-aloud + voice-viz
   (so any answer can be spoken with the core reacting).

## Status
- **P1 — DONE (2026-07-10, commit `4019111`).** `intent-router.ts` (regex vi+en; creation verbs win on
  ambiguity) + `report-answer.ts` (real `metricsForPeriod`→`buildImpactReport`, Gemini-authored answer in
  the user's language, deterministic vi/en fallback). Router answers a data-query on a reply-only
  `answered` run (no nodes/plan card) before marketing analysis; `recordAnswerTurn` persists the Q+A.
  Verified e2e in the UI: "how are my campaigns going?" → real numbers (13 posts FB/IG/TH/LI/X, no plan
  detour) + read-aloud offer (→ with voice mode, auto-spoken, core reacting).
- **P3 — DONE (2026-07-10, commit `783f081`).** Per-user long-term memory. `UserMemory` model
  (`mkt_memory`; migration `20260710121927`), `user-memory-repo.ts` (keyed upsert / freeform dedup),
  `user-memory.ts` service: `recallForMessage` (ranks captured facts + product library + brand defaults
  by keyword overlap → compact block, truncated) + `captureFromGoal` (deterministic slot capture). Wired
  into requirement-analyzer (recalled facts pre-fill product/brand/audience), master-agent handle/refine,
  and orchestration-router (recall before, capture after each turn — best-effort). Keyword-first, no
  embeddings (YAGNI). **Verified live e2e:** planned a GreenLeaf campaign → a NEW chat saying only "video
  về GreenLeaf" recalled "GreenLeaf, your organic tea brand, targeting busy young professionals" and
  planned with ZERO re-asking.
- **P2 — DEFERRED** (user 2026-07-10: Claude/GPT provider layer only AFTER demo success).
- **P4 — NOT STARTED** (next candidate). E2e test of 4 diverse flows (2026-07-10) surfaced exactly the P4
  gaps: (1)✅ marketing campaign plans; (2)✅ video→publish FB (memory recall excellent); (2b)✅ video→Drive
  (publisher correctly omitted); (3)❌ "email a friend happy birthday" forced into marketing "which
  platform?" framing — NO email-send node; (4)⚠️ full funnel understood + content planned, but
  lead-collector + email-nurture are separate cron SURFACES, not composable DAG nodes. → P4 = add a
  general email-send agent node + compose lead/nurture into the planner + general/task modes per node.

## Phases
### P1 — Intent Router + Data-Query answers (the "come back to" item; DO FIRST) ✅ DONE
Insert a lightweight **intent classifier** at the front of the message flow (before marketing analysis):
`create-content | data-query | general-question | refine`. For **data-query** ("how are my campaigns
going?", "how did X do?", "tình hình chiến dịch", "impact tháng này"):
- Fetch `metricsForPeriod(ownerId, 30d)` (or a named campaign) → `buildImpactReport` → author a concise
  spoken-ready answer (reuse the report `headline` + 1-2 measured highlights).
- Return a **reply-only** outcome — a run with a new terminal status `answered` (no nodes, no plan card);
  the chat shows the bubble; read-intent auto-offers to read it aloud (core reacts).
- Classifier: start regex/keyword (vi+en, like `read-intent.ts`) → upgrade to LLM classification in P2.
Files: new `intent-router.ts`, `report-answer.ts`; `orchestration-router` createRun branch; run status
enum `answered` + frontend `applyRun`/render guard (no Execute/plan UI on `answered`).

### P2 — Model-agnostic LLM provider layer
Abstract the ~10 direct Gemini calls behind ONE interface (`llm.complete()`, `llm.json()`, `llm.tts()`).
Pluggable providers: Gemini (default), **Anthropic Claude**, OpenAI. Per-surface model config + failover
(ties to the TTS 502 flakiness). Route the intent-classifier + conversation reasoning through the best
available reasoning model (Claude/GPT) while keeping media on their native providers.
Files: `src/llm/provider.ts` (interface + registry), adapters `gemini-provider.ts`/`anthropic-provider.ts`,
migrate call sites incrementally (start with llm-json + conversation-author + intent-router).

### P3 — Memory architecture
Give Atria real memory beyond the current conversation: (a) **session memory** (recent turns, already
partial), (b) **workspace/tenant memory** (facts: products, brand, audience, past campaigns, results),
(c) **semantic recall** (embed + retrieve relevant past context per turn). Feed retrieved memory into the
reasoning prompt so Atria "remembers" without re-asking. Consider a `mkt_memory` store + embeddings
(pgvector) or a lighter keyword store first (YAGNI).

### P4 — De-marketing the agent nodes (the "each node has a lot of story")
Audit every agent node's inputs/outputs + where it hardcodes the marketing framing; give each a
**general/task mode** (concept_writer → general script/creative writer; ideation/strategy → optional, not
mandatory for creative tasks; publisher stays). Let the planner compose nodes for ANY goal (educational,
informational, creative), not just campaigns. Separate report/plan.

## Recommended order
P1 (data-query — visible WOW, small) → P2 (provider layer — unblocks Claude/GPT reasoning) → P3 (memory)
→ P4 (de-marketing nodes). P1 is independently shippable now.

## Risks / notes
- New `answered` run status touches the status enum + frontend guards — keep it isolated.
- Provider abstraction is a broad refactor — migrate incrementally, keep Gemini default, verify each surface.
- Reasoning quality jump really lands in P2 (Claude/GPT for the reasoning brain) + P3 (memory context).
- Don't over-build memory (P3) — start with tenant facts + recent turns before embeddings.

## Success criteria
- "How are my campaigns going?" → Atria answers with your real Impact numbers (spoken, core reacting), no
  content-plan detour. (P1)
- Reasoning/classification can run on Claude/GPT via config, not only Gemini. (P2)
- Atria recalls your product/brand/past results without re-asking. (P3)
- A non-marketing creative request composes only the needed general agents. (P4)
