# Debug: Atria overrides "plan week/month campaigns" with the saved 7-step flow

**Date:** 2026-07-13 · **Reporter:** investigation (read-only) · **Severity:** high (core UX confusion) · **Status:** ROOT CAUSE FOUND, fix proposed, NOT applied

## Symptom
User has a SAVED flow (7 steps, `kind='template'`, approved). Two capabilities collide:
1. **Create Campaign for the flow** → `createCampaignFromFlow` (clones the 7-step flow DAG into ONE campaign/post).
2. **Plan week/month Campaigns** → strategist calendar (campaignScope≠single → `campaign_ideas → strategy_brief → content_calendar` → user edits → `materializeCalendar`, each slot a FRESH registry DAG).
When the user asks to PLAN weekly/monthly campaigns, Atria produces the original 7-step flow instead of a campaign calendar.

## Root cause — "campaign(s)" is a blind spot in the plan-scope regex
Weekly/monthly routing is gated entirely by `goal.campaignScope !== 'single'` (`workflow-planner.ts:48` → strategist targets). Scope is set by `inferCampaign` (`deterministic-analyzer.ts:111-119`): `isPlan = CAMPAIGN_PLAN_RE.test(t) || parseDurationWeeks || parseCadencePerWeek`.

`CAMPAIGN_PLAN_RE` (`deterministic-analyzer.ts:90`) keys on **posts / content / calendar**, NOT the word **campaign**:
```
content calendar | content plan | posting schedule | plan (a|the|out|my)? (month|week|content)
| a month of | weeks? of content | weekly (posts?|content) | month.long campaign | multi.?post
| series of posts | lịch đăng | kế hoạch nội dung
```
So "**plan weekly campaigns**", "**monthly campaigns**", "**chiến dịch hàng tuần/tháng**" → NO match (`weekly (posts|content)` ≠ "weekly campaigns"; `plan ... (month|week|content)` ≠ "plan ... campaigns"). No number either → `parseDuration/Cadence` = null.
→ `isPlan=false` → `campaignScope='single'` → planner builds a SINGLE flow. On a saved-template session the brain re-emits the 7-step flow = **"override with original flow."**

Note the two detectors use MISMATCHED vocab:
- `campaign-intent.PLAN_INTENT` (the guard that correctly PREVENTS create-from-flow) is BROAD — matches `weekly|week|plan|schedule|monthly|...`. So the message correctly falls THROUGH to the brain.
- `deterministic-analyzer.CAMPAIGN_PLAN_RE` (that must TRIGGER the calendar) is NARROW and campaign-blind. → dead zone: falls through, then scopes to single.

The user literally named the feature "Plan **week/month Campaigns**" — the trigger word is *campaigns*, which the scope regex ignores.

## Evidence chain (files:lines)
- `api/orchestration-router.ts:188-216` template branch → `detectCampaignIntent`; PLAN_INTENT → isCreate:false → falls to brain (`priorGoal=null` for template sessions, but full `prior` history passed).
- `master/campaign-intent.ts:29-32,64` broad PLAN_INTENT guard.
- `master/deterministic-analyzer.ts:90` NARROW `CAMPAIGN_PLAN_RE` (no "campaign(s)"), `:111-119` `inferCampaign`.
- `master/requirement-analyzer.ts:115-116` backfills det.campaignScope (so fixing deterministic propagates).
- `master/workflow-planner.ts:45-49` scope≠single → strategist calendar. Deterministic authority.
- `master/campaign-materializer.ts:1-9` confirms weekly path re-plans per slot (NOT the template) — so once scope is right, the flow can't leak in.

## Proposed fix (minimal, precise)
Widen scope detection to treat "campaign(s)" as plannable ONLY when paired with a period/plan word (keep bare "create a campaign" = single, which is handled pre-brain anyway). Add to `CAMPAIGN_PLAN_RE`:
- `(?:weekly|monthly)\s+campaigns?`
- `campaigns?\s+(?:for\s+)?(?:the\s+|this\s+|next\s+)?(?:week|month)`
- extend existing alt: `plan (a|the|out|my)?\s*(?:month|week|content|campaigns?)`
- VN: `chiến dịch\s+(?:hàng\s+)?(?:tuần|tháng)|chien dich\s+(?:hang\s+)?(?:tuan|thang)`

Safety: genuine single-campaign create-from-flow never reaches `inferCampaign` (handled at router:191 by `detectCampaignIntent.isCreate` before the brain), so widening here can't hijack a legit single create. Add `verify-campaign-intent`/deterministic cases: "plan weekly campaigns"→campaign, "monthly campaigns"→campaign, "chiến dịch hàng tuần"→campaign, "create a campaign"→single (unchanged).

## Secondary hardening (optional)
On `kind='template'` sessions, when scope≠single, ensure the brain does NOT anchor on the template flow in `prior` — the deterministic planner already ignores it, but a one-line steer (skip feeding the template DAG as an exemplar) removes any LLM anchoring risk.

## Unresolved
- Confirm the exact failing message the user typed (to add as a regression case verbatim).
- Should "plan campaigns" with no period default to campaign (month×3) or ask? (currently would stay single unless period word present — recommend require a period word to avoid over-triggering).
