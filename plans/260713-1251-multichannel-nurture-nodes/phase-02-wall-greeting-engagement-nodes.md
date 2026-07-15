# Phase 02 — Mention/Reply Greeting Node (X, Threads, Facebook, Instagram)

**Priority:** Medium · **Status:** DONE (DRY-RUN scaffold, not live-tested) · **Verdict scope:** X 🟡 (mention degrades — Mar-2026 policy; reply live), Threads 🟢 (mention+reply live), FB 🟡 (mention live text-tag; reply unsupported — no reply-to-arbitrary-post shape), IG 🔴 (mention+reply both unsupported — no text-only post, no reply-to-arbitrary-post). Literal wall posting 🔴 excluded everywhere.

## Overview
A `greeting_writer`→`greeting_agent` pair that posts a **public, person-directed greeting** — an @mention post on our own timeline or a reply to their post — through the EXISTING social adapters. This is the only buildable interpretation of "greet them on their wall."

## Key insight
- All 4 targets are already `SocialPlatform`s with live adapters (`src/social/{x,threads,facebook,instagram}.ts`), OAuth, connection-resolver, token vault. **Reuse all of it.**
- What's missing is a **new adapter action**: today adapters only `publish(PublishInput)` (own-timeline post). Greeting needs `mention` (own post tagging a handle) and/or `reply` (in-reply-to their post id). Add these as new methods, keep `publish` untouched.
- "Greeting" ≠ marketing publish → separate node so it doesn't drag the ideation/asset pipeline. Gate `publish` (external write), `requiresApproval:true`.

## Requirements
**Functional:** given target handle/post-id + platform + greeting text, create an @mention post or reply; return permalink. Refuse platforms where the action is unsupported (FB/IG have no reply-to-arbitrary-post → only comment-on-their-post or tag-in-our-post).
**Non-functional:** prior-engagement rule (X Mar-2026) surfaced as a pre-check; no burst; audit each greeting.

## Architecture
Extend `SocialAdapter` (`src/social/types.ts`) additively:
```ts
interface SocialAdapter {
  publish(input): Promise<PublishResult>;          // unchanged
  mention?(input: MentionInput): Promise<PublishResult>;  // own post @handle  (X, Threads, FB Page, IG caption)
  reply?(input: ReplyInput): Promise<PublishResult>;      // in-reply-to postId (X, Threads; FB/IG = comment)
}
```
`greeting_agent` runner picks `mention` vs `reply` from goal, fans to `goal.platforms` via a `greetTo(platform, action, input)` shim (mirror `publishTo`). Adapters that don't implement the action return `{ok:false, error:'unsupported'}` (never throw).

## Related code files
**Read:** `src/social/x.ts` (create-tweet/reply reference), `src/social/index.ts` (`publishTo` fan-out), `src/social/threads.ts`, `src/social/facebook.ts`, `src/social/instagram.ts`, `src/connectors/runtime/connector-runtime.ts` (`invokeAction` kill-switch/idempotency to reuse), `src/orchestration/executor/agent-runners.ts` (`runPublisher` L282 as runner template).
**Create:** `src/social/greeting.ts` (`greetTo` fan-out + `MentionInput`/`ReplyInput` types), adapter `mention`/`reply` impls in each of the 4 `src/social/*.ts`.
**Modify:** `agent-types.ts` (`RunnableAgentId += 'greeting_writer'|'greeting_agent'`), `agent-registry.ts` (+2 defs, `capabilities:['social.mention','social.reply']`), `agent-runners.ts` (+2 runners, `ctx.greetFn` DRY seam), `artifact-schemas.ts` (`greeting_draft`,`greeting_result`), `goal-spec.ts` (slots `greetTarget`{handle|postId|platform}, flag `needsWallGreeting`), `workflow-planner.ts` (`targetsFromGoal` map + `PIPELINE_ORDER` + `TERMINAL_ACTIONS += 'greeting_agent'`).

## Implementation steps
1. Additive `mention`/`reply` on `SocialAdapter` type; implement on X + Threads first (both support reply+mention), FB/IG as `mention`(tag in own post)+`comment` only.
2. `src/social/greeting.ts` `greetTo` fan-out mirroring `publishTo` (asset-less text action).
3. Route through `invokeAction` for kill-switch/idempotency/audit (reuse, don't duplicate).
4. Artifact types + schemas; registry defs; runners with DRY seam.
5. GoalSpec slots + `needsWallGreeting` flag + planner splice + TERMINAL_ACTIONS (schedulable greetings).
6. X prior-engagement pre-check (surface as degraded result, not hard fail).

## Todo
- [x] `SocialAdapter.mention/reply` (additive type)
- [x] X + Threads mention/reply impls (live code; X mention pre-check degrades per Mar-2026 policy)
- [x] FB mention (live, text-tag) + IG deferred (no text-only post — both unsupported, documented)
- [x] `greeting.ts` fan-out — DRY-RUN gate (`ENABLE_LIVE_GREETING_SEND`, off by default) + idempotency
      via the EXISTING `external_action_audit_log` (reused, no new table); `invokeAction`/
      connector-registry NOT extended this phase (PublishInput-shaped, out of scope — see report)
- [x] Artifact types+schemas (`greeting_draft`/`greeting_result`)
- [x] Registry + runners (`ctx.greetFn` DRY seam)
- [x] GoalSpec (`needsWallGreeting`, `greetHandle`/`greetPostId`) + planner splice + TERMINAL_ACTIONS
- [x] `verify-greeting-node.ts` (DRY, 0 real posts): fan-out, unsupported-action degrade, gate,
      double-post guard, X pre-check, adapter-failure — all green; golden/DM/email regressions green

## Success criteria
`tsc` green; verify DRY passes; one REAL X @mention post + one Threads reply to a test account; FB/IG mention-tag validated once. Unsupported action degrades gracefully (never throws).

## Risk / security
- X write tier + prior-engagement rule may block replies → check tier (synthesis Q3) before enabling X.
- Public greeting is outward-facing → approval gate mandatory; no automated fan to many targets (burst rule).
- Reuse existing token/kill-switch; no new credential surface.

## Next steps
Independent of Phase 01. Shares scheduler node for timed greetings. Gated on X API tier confirmation.
