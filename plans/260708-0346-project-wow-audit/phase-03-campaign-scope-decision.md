# Phase 03 — Campaign-scope exposure (DECISION, then conditional widen)

**Priority:** P0-labeled by audit, but this is a PRODUCT DECISION, not a bug.
**Status:** BLOCKED on decision.

## The current behavior is intentional
`deterministic-analyzer.ts:79-120`. Bare "campaign"/"branding"/"brand"/"chiến dịch" →
`isCampaign=true` → runs the fuller ideation→strategy→image pipeline as a rich SINGLE post.
Only an UNAMBIGUOUS multi-post intent (`CAMPAIGN_PLAN_RE` :90, a parsed duration, or a cadence)
→ `campaignScope='campaign'|'spotlight'` → the calendar → selection-gate → materialize flow.
The code comments this as deliberate (`:86-88`): "bare campaign/branding already drives the rich
SINGLE-post pipeline — only unambiguous MULTI-post intent escalates, so existing one-post goals
are unchanged."

## The demo tension
A user who says "build me a branding campaign for my coffee shop" EXPECTS a multi-post plan
(calendar), but gets one rich post. The strategist (the flagship WOW feature) never appears
unless they phrase it as "plan a month" / "3 posts a week".

## Decision needed (user)
- **A. Widen** — treat bare "campaign/branding" (without an explicit single-post cue) as
  multi-post. Change: set `campaignScope='campaign'` when `isCampaign(t)` is true and no
  single-post signal. Risk: some users saying "campaign" want one post; guard w/ a follow-up
  question instead of silently fanning out.
- **B. Nudge (recommended, low-risk)** — keep the default single, but when `isCampaign(t)` is
  true and scope stayed `single`, have Atria ASK in-chat: "One strong post, or a full multi-post
  calendar?" — surfaces the strategist without guessing. Fits the existing clarification loop
  (`conversation-author.ts`).
- **C. Leave as-is** — document the trigger phrases; brief the demo script to use "plan a month".

## Conditional implementation (if A or B)
- **A**: in `inferCampaign` (`:111-120`), when `isCampaign(t)` and not spotlight and no explicit
  single cue → `scope='campaign'` with default 4wk×3/wk. Add a single-post opt-out keyword set.
- **B**: add a clarifying question in the deterministic clarification set when `isCampaign &&
  campaignScope==='single'`; wire the answer back to re-run intake with scope.

## Todo (after decision)
- [ ] Decide A / B / C
- [ ] If A/B: implement per above; verify "branding campaign for X" surfaces the calendar path
- [ ] Confirm plain "write a post" still stays single (no regression)

## Success criteria
- A natural campaign request reaches the strategist calendar (A/B), OR is documented (C).
- Single-post goals unaffected.
