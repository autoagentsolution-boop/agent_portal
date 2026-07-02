# Phase 02 — Master Agent reuses saved flow (item 2)

**Priority:** HIGH (most confusing bug for a buyer)
**Status:** DONE 2026-07-02

## Outcome (Option B — routing, no new backend create logic)
- `campaign-intent.ts` — deterministic VN+EN create-intent detector (verb+noun, or bare affirmation to the save-offer). ⚠ `\b` is ASCII-only → "có" needs anchored `^...$` not `\b` (same diacritic lesson).
- `POST /runs`: when the chat's latest run is `kind=template` AND intent.isCreate → return the SAME template run + `campaignIntent:true` + authored reply (no fork). Falls through to `handle()` for genuine new-flow requests (control case verified).
- `recordCampaignIntent()` in orchestration-chat.ts (persists user msg + saveOfferAuthor reply).
- DTO: `campaignIntent?:boolean` added to schemas.ts + mapper; regenerated openapi.json + web schema.d.ts.
- Web: OrchestratePanel shows SaveOfferCard when `run.campaignIntent` (setup binds campaign to THIS flow via existing `onSetupCampaign`→`setupFirstCampaign`, which already works).
- 2c platforms: PlanCard "Publishes to:" chips + RunDagView publisher node `→ platforms` (before publish) wired in saved-flow-detail + post-workflow-view. CSS added.
- Verified: verify-campaign-intent 10/10, verify-campaign-reuse-http 8/8, template-instance + save-offer + post-inherit regressions green vs rebuilt container; tsc + web build clean.
- New guards: `src/orchestration/verify-campaign-intent.ts`, `src/orchestration/verify-campaign-reuse-http.ts`.

## Context (masteragent1.png)
User saved flow "AgentAgency". Then chatted: *"Let make a first campaign 'Abstract User'. First post 'Do you tired of Manual work?'"* → MA re-asks platforms/audience/type (loop), and on approve **creates a whole new flow** instead of a campaign+post under the saved "AgentAgency" flow. Also: publisher step never shows which platforms were selected.

## Three sub-bugs

### 2a — Follow-up forks a new flow (the core bug)
`orchestration-router.ts` POST /runs:
```ts
const existing = body.chatSessionId ? getLatestRunWithNodesForChat(...) : null;
const refine = existing && existing.kind !== 'template' && PRE_EXEC.has(existing.status);
```
After `/save`, the latest run is `kind='template'` (nameRun sets kind=template, status=template). So `refine=false` → `masterAgent.handle(message)` plans a brand-new flow from scratch. The user's "create a campaign under this flow" intent is interpreted as "plan a new flow".

**This is by-design for template immutability** (a saved blueprint mustn't mutate) — but it has no CAMPAIGN-CREATE branch. The missing capability: when the chat's latest run is a saved template AND the user asks to create a campaign/post, MA should CREATE A CAMPAIGN bound to that template (`campaign.flowId = template.id`) + optionally a first post (which clones the template per existing `cloneTemplateRun` path), NOT plan a new flow.

### 2b — Loop of re-asking
Because 2a routes to `handle()` (fresh analysis), the new message "same as scope above" has no product/platforms → clarification engine re-asks everything. Fixing 2a (bind to template, carry its goal) eliminates the loop: the template's goal already has product/platforms/audience.

### 2c — Publisher doesn't show selected platforms
`orchestrate-run-cards.tsx` PlanCard / RunDagView renders nodes but never surfaces `goal.platforms`. brief screenshots confirm the publisher node just says "Publisher". Buyer can't see FB+IG were chosen.

## Design — minimal, reuses existing machinery

The campaign-create machinery already exists:
- `onSetupCampaign(runId)` in OrchestratePanel → App creates a campaign under the flow (verify App.tsx handler).
- `cloneTemplateRun(flowId, ...)` clones template → instance run when a post is created under a flow-attached campaign (posts-router POST /).

So the fix is **routing + intent**, not new create logic (matches P6 doc: "conversational offer + routing, not new create logic").

### Approach
1. **Detect campaign-create intent on a saved-template chat.** In POST /runs, when `existing?.kind === 'template'` and the message expresses "create campaign/post" intent, DON'T call `handle()`. Instead:
   - Author a reply confirming campaign creation under the existing flow.
   - Trigger the campaign-create path (reuse the same code `onSetupCampaign` calls server-side) with fields parsed from the message (campaign name, first post title) OR return an action the UI executes.
   - **Simplest (KISS):** return the existing template run + an `assistantMessage` that says "I'll set up a campaign under {flowName}" + a structured hint the panel uses to call the existing setup-campaign flow. Avoid a new heavy planning branch.
2. **Intent detection** — deterministic keyword match (create/make/tạo + campaign/post/chiến dịch/bài) in a new small helper (mirror deterministic-analyzer style). Avoid an LLM round-trip for routing.
3. **2c** — in `orchestrate-run-cards.tsx` PlanCard, render a platform chip row from `run.goal.platforms` near the publisher node (or as a card subtitle "Publishes to: Facebook, Instagram"). Same in the post-board DAG publisher node (`run-dag-view.tsx`) — show target platforms even before publish (currently only shows postUrls AFTER publish).

## Open question for implementation
The cleanest server behavior when a saved-template chat gets a "create campaign" message:
- **Option A** (recommended): backend detects intent, creates the Campaign bound to `flowId=template.id` with goal-derived fields, creates first Post (clones template), returns a response the panel routes to the campaign board. One round-trip, no loop.
- **Option B**: backend just replies "click Set up campaign" and relies on the existing SaveOfferCard button. Less magical but zero new create logic. Falls back to buttons the user already has.

Lean A for demo polish; B is the safe fallback if A balloons. Decide during impl after reading App.tsx's `onSetupCampaign`.

## Related code files
- READ `MKTAgent/web/src/App.tsx` — `onSetupCampaign` handler (what campaign-create already does client-side)
- MODIFY `MKTAgent/src/api/orchestration-router.ts` — POST /runs template-chat intent branch
- CREATE `MKTAgent/src/orchestration/master/campaign-intent.ts` — deterministic "create campaign/post" detector (small, VN+EN, `\p{L}` safe)
- MODIFY `MKTAgent/web/src/components/orchestrate-run-cards.tsx` — platform display (2c)
- MODIFY `MKTAgent/web/src/components/run-dag-view.tsx` — publisher target platforms (2c)
- READ `MKTAgent/src/db/repos/campaign-repo.ts` — createCampaign signature (flowId param)

## Todo
- [ ] Read App.tsx onSetupCampaign + campaign-repo.createCampaign
- [ ] campaign-intent.ts detector (+ unit coverage)
- [ ] POST /runs branch: saved-template + create-intent → bind campaign to flow (Option A or B)
- [ ] 2c: platform chips on PlanCard + publisher node
- [ ] verify-api / master verify green vs container
- [ ] tsc + web build
- [ ] Manual e2e reproducing masteragent1.png: save flow → "create campaign X, post Y" → campaign appears UNDER the flow, no new flow, no re-ask loop

## Success criteria
- Continuing a saved-flow chat to create a campaign binds a campaign to THAT flow (sidebar: campaign nests under the flow), never a new flow.
- No clarification loop — template's goal supplies product/platforms/audience.
- Plan card + publisher node display selected platforms.

## Risks
- Intent misdetection could hijack a legitimate "plan a different flow" message. Mitigation: only trigger the bind-branch when latest run is a template AND intent clearly names campaign/post; otherwise fall through to fresh `handle()`. Conservative matching.
- Option A adds create side-effects to POST /runs (currently side-effect-light). Keep it guarded + logged; fall back to B if it complicates tenancy/idempotency.
