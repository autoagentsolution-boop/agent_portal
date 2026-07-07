# Phase 08 — UI v2: Calendar · Instructions · Suggestions · Campaign Board · Impact

**Priority:** HIGH (what the user SEES). **Status:** planned. **Depends on:** 02–07 (their APIs).
**Goal:** Surface the whole story: edit instructions, review a calendar, accept a proactive suggestion,
watch the campaign run, read the impact. Parallelizable once 02–07 backends are stable.

## Surfaces
1. **Instruction editor** (Phase 02) — a settings surface: Workspace instructions (the "how I want my
   content" box, ChatGPT-style) + per-campaign / per-agent overrides. Live preview of the composed
   instruction block. This is where "make content better + on-brand" becomes a user control.
2. **Content Calendar review/edit** (Phase 03/04) — week/month grid: per slot pillar / angle / format /
   platforms / suggested day+time / rationale; edit (reword, change format/platform, move, add/delete)
   before materializing. "Approve & schedule" → materialize (P04) + campaign grant (P05) with the
   **upfront cost estimate** shown in the 2-step confirm.
3. **Proactive suggestion cards** (Phase 06) — home/command-center cards from `GET /atria/suggestions`:
   headline + rationale + one CTA. Accept "plan a month" → prefilled calendar flow; accept a roadmap
   pitch (e.g. Memory / Email) → logs demand. Dismissible; never auto-acts. The "smart assistant" WOW.
4. **Campaign command view** (Phase 05) — live board: each post's status dot (planned/running/held-
   needs-you/posted/failed) via SSE; held posts show the guardrail reason + resolve action.
5. **Impact report view** (Phase 07) — the money shot: "$20 vs ~$540 / 6 weeks", real cost/output/leads,
   estimates clearly tagged, per-pillar what-worked. A shareable proof-of-value screen.

## Reuses
- `run-dag-view.tsx` (per-post DAG under a slot), SSE client, `web/src/lib/credits.ts` (cost estimate),
  command-center page shell.

## Related code files
Create: `web/src/components/instruction-editor.tsx`, `content-calendar.tsx`, `atria-suggestion-cards.tsx`,
`campaign-command-view.tsx`, `impact-report.tsx`, API client methods.
Modify: `web/src/api/client.ts` (DTOs), command-center page, routing.

## Steps
1. Client DTOs + methods (instructions, calendar, materialize, grant, suggestions, campaign status, impact).
2. instruction-editor + content-calendar (edit → approve & schedule).
3. atria-suggestion-cards (poll → render → accept).
4. campaign-command-view (SSE board, held-post resolve) + impact-report view.
5. tsc web + a screenshot/e2e: suggestion → calendar edit → grant → campaign board → impact report.

## Acceptance
- End-to-end in the UI: edit instructions once (content changes), accept a suggestion, edit the calendar,
  one grant, watch N posts publish, read a truthful impact report. No action fires without double-confirm.

## Next → v2: real platform metrics (Analytics agent) + learned instructions/anticipation (Memory agent)
+ capability/LLM-driven planner (Pillar 2) + building the roadmap agents as runners.
