# Phase 06 — Proactive Suggestion + Agent-Roadmap Pitch (the WOW)

**Priority:** HIGH (differentiator). **Status:** planned. **Depends on:** 03–05 (something to suggest).
**Goal:** Atria FORESEES the next need and offers it — no PII, transparent heuristics, always
suggest→confirm→run. On a capability gap, it pitches the matching roadmap agent + logs demand.

## What's new
1. **Signal reader (no PII)** — `atria/signal-reader.ts`: reads EXISTING data only (campaign/post history
   counts, products, platforms, cadence, approve/reject ratio, lead volume, connection state,
   `profile-facade`, and Phase-07 impact numbers). Derives behavioral SIGNALS; stores no message content
   or personal data. Pure + testable.
2. **Suggestion engine** (`atria/atria-suggestions.ts`) — deterministic rules map signals → ranked
   `Suggestion[]` `{ kind, headline, rationale, prefilledAction }`. Rules are explainable (rationale
   shown — the trust story). v1 examples:
   - ≥3 one-off posts, same product, no active campaign → "Plan a full month?" (prefills Phase-03 intent).
   - ≥N un-nurtured leads + no email capability → pitch **Email Forecast** (roadmap).
   - Finished campaign with an Impact report → "Repeat what worked?" (prefills next calendar from the
     winning pillars) — closes the loop with Phase 07.
   - User keeps re-editing/re-instructing content (high edit/refine ratio, or repeated similar
     instruction edits) → **pitch the Memory Agent**: "You keep making my copy punchier — want me to
     REMEMBER your style so every post lands right the first time?" Accepting it (v2) lets Memory
     auto-refine the Phase-02 instructions (`source:'memory'`, user-reviewable). This is the concrete
     answer to "make content better and better by learning the user" — surfaced as a proactive pitch.
3. **Agent roadmap** (`registry/roadmap-agents.ts`) — formalize `vision-agents` into a roadmap Atria
   KNOWS: `{ id, name, whatItWouldDo, triggerSignal }`. Pitch when a trigger fires; a `RoadmapDemand`
   log records each pitch/accept (real demand for the team). Compose existing agents when possible.
4. **Delivery seam** — `GET /atria/suggestions` (ranked, owner-scoped); accept → prefilled Phase-03 flow
   or a logged roadmap demand. NOTHING runs until the user confirms + grants (decision #2).

## Explicitly NOT in v1
- No ML/embeddings — heuristics only. No new runnable agents (roadmap pitched, not executed). No data
  collection beyond what the app already stores; no cross-tenant learning.

## Related code files
Create: `orchestration/atria/signal-reader.ts`, `orchestration/atria/atria-suggestions.ts`,
`registry/roadmap-agents.ts`, a demand-log repo, `orchestration/verify-atria-suggestions.ts`.
Modify: `api/orchestration-router.ts` (or new `atria-router.ts`). Read: `memory/profile-facade.ts`,
`leads/*`, impact repo (Phase 07).

## Steps
1. signal-reader (pure read → signals) + verify with seeded history.
2. rule-based suggestion engine + roadmap pitch + demand log.
3. `/atria/suggestions` endpoint (ranked, explainable).
4. Verify: "3 one-off posts same product" → campaign-plan suggestion w/ prefilled intent + rationale;
   "many leads, no email" → Email-Forecast roadmap pitch + demand logged; no signal → no noise.

## Acceptance
- Given realistic history, Atria emits the RIGHT suggestion (with shown rationale, prefilled to Phase-03)
  proactively; a gap pitches the roadmap agent + logs demand; nothing executes without a grant.

## Next → Phase 07 gives the "repeat what worked" suggestion its data.
