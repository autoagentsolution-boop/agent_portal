# Project WOW Audit — Atria / AgentPortal (2026-07-08)

Read-only conformance + bug audit across 5 domains by 4 parallel auditors. No code changed.
Detail reports in `plans/reports/qa-260708-0346-*.md`. This is the consolidated action doc.

## Bottom line
The "WOW" core is **real, not smoke-and-mirrors**: genuine LLM-extract + rule-plan hybrid,
a live multi-post strategist (calendar→gate→materialize), a real single publish gate, a real
fail-closed autonomy seam (HMAC double-confirm), accurate token accounting (incl. thinking
tokens), and real runners behind all 9 registered agents. The problems are **wiring / exposure
/ persistence gaps**, not fundamental fakery. Four are demo-breaking (P0) and all are cheap.

## Domain verdicts

| Domain | Verdict | Report |
|---|---|---|
| A — Atria brain (intelligence, planning, strategist, suggestions) | ✅ real, 1 P0 exposure gap | `qa-...-atria-brain-intelligence.md` |
| B — Execution, gates, on-behalf autonomy, skip-video | ✅ mostly real, 1 P0 kickoff gap | `qa-...-execution-gates-autonomy.md` |
| C — Cron + link-status persistence | ⚠ cron real, persistence bug confirmed | `qa-...-cron-linkstatus-persistence.md` |
| D — Usage, impact, agent nodes, Command Center | ✅ real, 1 P0 double-count bug | `qa-...-usage-impact-nodes.md` |

## What's genuinely solid (don't touch)
- **Language mirroring** any-language off raw message (`conversation-author.ts:124-127`), not vi/en binary.
- **Strategist** is live multi-post: real Gemini calendar (N≈cadence×duration), selection gate, real materialize into scheduled posts. Not stubbed.
- **Proactive suggestions** computed from real DB counts w/ number-grounded rationale.
- **Publish gate**: single chokepoint `runtimePublishFn` (`workflow-executor.ts:398-416`).
- **Autonomy seam**: HMAC double-confirm (`autonomy-grant-token.ts`), fail-closed policy (`approval-policy.ts:36-55`), park-on-hold; stale-attachedPost auto-publish bug already FIXED (fresh `getPostByRunId`).
- **Post=instance**: `cloneTemplateRun` (`workflow-run-repo.ts:102-132`) w/ live-registry re-validation.
- **Skip-video**: `MEDIA_AGENT_ASSET` gating (`workflow-executor.ts:283-288`), no Veo waste.
- **Usage accuracy**: thinking tokens billed at output rate; per-owner `mkt_llm_usage` ledger; Veo/image/TTS + grounding surcharge captured.
- **Impact honesty**: measured vs estimated cleanly separated (`estimated:true` marker; "estimated ~$Y with an agency").
- **Command Center** (Atria's intended final form): shows real registry data + real credit total; `onLaunch` funnels into live chat; no stub shown as runnable → no upward-misleading risk.
- **Reapers** real, cron-driven (`reaper.ts`, 5-min); no early/double-publish (`scheduledAt lte now` + atomic `updateMany` claim).

---

## FIX LIST — tomorrow (prioritized)

### P0 — demo-breaking / correctness (do first)

**P0-1 · Campaign-intelligence hidden behind phrasing** [A]
Natural "build me a branding campaign for my coffee shop" → intake returns `campaignScope='single'`
→ single post, calendar UI never appears. Only literal "plan a month" / "3 posts a week" escalate.
- Fix: teach the intake prompt to set `campaignScope`, OR broaden the escalation regex.
- Sites: `deterministic-analyzer.ts:79-119`, `requirement-prompt.ts` (intake prompt).

**P0-2 · Autonomy grant never kicks off** [B]
Granting autonomy only flips `approvalMode='atria'`; run stays `planned`, materialized posts sit at
`status='brief'`, and nothing executes/publishes the granted DAG (scheduler only publishes `ready`).
- Fix: wire `launchWorkflow` into the grant path, OR add a granted-run executor cron.
- Sites: campaign-grant path + scheduler. ⚠ First confirm: intentional scope vs unfinished Phase-05 wire.

**P0-3 · Link-status not persisted → lost on refresh** [C] (user-observed)
`checkPostLinks` computes `alive` live every call but its `prisma.post.update` only fires on comment-
source death — never persists the liveness result. No `linkStatus` column exists. Web UI holds it in
transient `useState`, populated only by the manual button; `load()` never re-fetches → refresh wipes it.
- Fix: add `Post.linkStatus Json?` column; make the DB write unconditional; expose in post DTO; seed web state on load.
- Sites: `prisma/schema.prisma` (Post), `post-liveness.ts:55-58`, `LeadsPage.tsx:46,48-59,127`, `toPostDto`.

**P0-4 · Impact credits double-count media rows** [D]
`impact-metrics.ts` sums `creditsFromTokens(all tokens)` + `creditsFromUsd(all media USD)` WITHOUT the
`totalTokens:0` filter the Usage page uses → Impact report and Usage page show different credit totals
for the same activity (visible reconciliation gap). `usdSpent` is fine.
- Fix: add `totalTokens:0` filter to the two media aggregates.
- Sites: `impact-metrics.ts:47,77`.

### P1 — polish / correctness (before demo)

- **P1-1 · Stale agent labels** [D]: infographic/storyboard/video are `implStatus:'stub'` in registry but fully LIVE → render dimmed/"stub" (undersells). Flip to `'live'`. Site: registry.
- **P1-2 · Auto-publish default ON waives gate** [B]: cleanly-postable posts skip the approval gate by default. Decide desired demo behavior (default off / explicit toggle).
- **P1-3 · Cron flags default off** [B/C]: `ENABLE_SCHEDULER_CRON`, `ENABLE_REAPER_CRON`, `LEADS_CRON` default `false` (`env.ts:19,56`). Ensure demo `.env` enables them; verify in running deployment.
- **P1-4 · Materialize silently drops slots** [A]: slots that fail to plan are skipped w/o surfacing → count mismatch. Surface partial failures.

### P2 — edges / hardening

- **P2-1** [A]: no-LLM fallback leaks hardcoded VN question seeds when `GEMINI_API_KEY` absent.
- **P2-2** [D]: a real LLM call missing `usageMetadata` records zero/no row (undercount edge).
- **P2-3** [B]: skip-video fresh-goal stale-snapshot edge.

---

## Unresolved questions (need decision, not investigation)
1. **P0-2**: Is the missing autonomy kickoff intentional scoping, or an unfinished Phase-05 wire? Changes the fix shape (feature vs bug).
2. **P1-3**: Are the demo `.env` cron flags actually enabled? Not verifiable from source (gitignored) — user must check the running deployment.
3. **P1-2**: Should auto-publish default be ON for the demo, or gated?

## Suggested order for tomorrow
P0-3 (persistence, isolated, clear fix) → P0-4 (one-line filter) → P0-1 (prompt/regex) → P0-2 (needs decision first) → P1 batch.
