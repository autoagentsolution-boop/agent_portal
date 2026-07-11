# Atria Reasoning Brain — consolidated review (commit 0b7724a)

Synthesis of 4 parallel reviews (QA/QC, Senior, Architecture, Cost). Source reports in same dir:
`qa-qc-*`, `senior-review-*`, `architecture-review-*`, `cost-audit-*`.

## Verdict
Design is **sound and v1-shippable**. Pattern (reasoning-loop-as-front-controller) is right; auth is clean (no Critical, no cross-tenant/injection); `tsc` 0 errors; backward-compat safe. BUT one **multi-turn regression** (found independently by 3 of 4 agents) + a latency risk + a credit leak should land before broad multi-turn use.

## Cross-agent convergence (weight = how many found it)
| # | Issue | Found by | Sev |
|---|---|---|---|
| 1 | **Multi-turn slot-accumulation regression** | QA(H2)+Arch(R3)+Senior(P0) ×3 | P0 |
| 2 | **No aggregate wall-clock budget (latency/DoS)** | QA(H1)+Senior(P0) ×2 | P0 |
| 3 | **Credit leak: web_search usage dropped** | Cost(LEAK-1) | P0/High |
| 4 | **Orphaned flow card (side-question shadows plan run)** | QA(M3)+Senior(P1) ×2 | P1 |
| 5 | **Unguarded recordGeminiCall → discards reply, degrades to marketing** | QA(M1)+Senior(P1) ×2 | P1 |
| 6 | Empty-text junk "…" turn on 5xx/no-candidates | QA(M2) | P1 |
| 7 | Near-zero observability (no round/tool/fallback logs) | Senior(P1) | P1 |
| 8 | Proposal contract marketing-coupled + selectAgents hardcoded ladder | Arch(R1/R2) | P1b |
| 9 | Unsanitized citation labels (phishing IF markdown-rendered) | QA(L1) | P2* |
| 10 | Per-round token growth (full contents+decls re-sent) | Cost | P2 |
| 11 | Gemini fetch boilerplate duplicated ~14× | Senior/Arch | P2-debt |

## Fix plan

### P0 — before broad multi-turn use
- **[1] Restore slot accumulation.** `propose_workflow` (atria-tools.ts:~115) calls `requirementAnalyzer.analyze` FRESH; `applyOutcomeToRun` overwrites `run.goal`. Fix: thread the existing run's stored `GoalSpec` into `propose_workflow` and `mergeGoals(prior, delta)` before `planFromGoal` (reuse the retired `masterAgent.refine` merge logic). Don't rely on the LLM restating every slot from `prior.slice(-8)`.
- **[2] Aggregate turn deadline.** atria-brain.ts loop: add a wall-clock budget (e.g. 45–60s total) across all rounds+nested tool calls; lower `MAX_ROUNDS` (5→3) and/or cap tool round-trips. Prevents multi-minute request hangs.
- **[3] Ledger web_search.** atria-tools.ts:97 — capture `usage` from `groundedSearch`, `recordLlmUsage({ownerId: ctx.ownerId, surface:'research', model, usage})`. Needs `recordLlmUsage`+`env` imports. Mirrors `run-research.ts:68`.

### P1 — hardening (same fix session)
- **[5] .catch on `recordGeminiCall`** in the loop try (atria-brain.ts:~83) so a ledger hiccup can't force the marketing `legacyFallback` and discard a good reply.
- **[5b] Don't degrade conversational failures to a marketing proposal.** On brain error mid-conversation, prefer a graceful conversational apology over `masterAgent.handle`.
- **[6] Empty-text fallback** (atria-brain.ts:~81/91): a transient 502 (with prior) or safety-block yields `text:''` → junk "…" turn. Emit a real fallback sentence; don't persist an empty turn.
- **[4] Flow-card shadowing:** a mid-setup `answered` run becomes "latest" (getLatestRunWithNodesForChat orders updatedAt desc) → next proposal forks a NEW run, card vanishes. Fix: prefer the latest PRE_EXEC run when one exists, or don't let `answered` shadow it.
- **[7] Observability:** log rounds taken, tools called, fallback reason; stop `dispatchTool` swallowing tool errors silently (log them).

### P1b scope (defer — feeds the node-decoupling goal)
- **[8]** `AtriaTurn.proposal = MasterAgentOutcome` is marketing-shaped by type; `selectAgents()` is a hardcoded marketing if-ladder. A future translate/summarize node can't drop in and compose without a GoalSpec flag + planner branch + analyzer regex. This is the core P1b work — decouple the proposal contract + make agent selection data-driven (edge derivation already is).

### P2 / debt
- **[9]** Sanitize/escape citation labels before persist/display (severity depends on whether frontend markdown-renders assistant messages — see open Q).
- **[10]** Slim per-round payloads (truncate web_search summary re-fed to contents; consider not re-sending all tool declarations every round).
- **[11]** Provider abstraction (`LlmClient`) — ~14 duplicated Gemini fetch seams; the function-calling wire shape is the most provider-coupled code (P2 model-agnostic goal).
- Delete dead code: `intent-router.ts` (classifyIntent), unused `masterAgent.refine`.

## Credit / cost impact (priority #2)
- **1 confirmed leak:** web_search un-billed (fix [3]). All other calls meter correctly to the tenant.
- **Cost multiplier vs old (old = 2 calls: intake+author):** simple reply ~0.5×; reply+search / data-query / proposal ~1.5×; worst case ~5× calls (~10 physical, ≤2 un-billed pre-fix). Token growth worse than call growth — each round re-sends full contents+system+declarations. Mitigations: fix [3] (leak), [2]+[10] (cap rounds + slim payloads), optional: drop redundant data-query `authorAnswer` (brain re-voices the numbers).

## Open questions (need user / verification)
1. Is there a reverse-proxy/gateway request timeout < 60s in front of POST /runs? (sets true severity of [2])
2. Does the frontend markdown-render assistant messages? (sets severity of [9])
3. Intended UX when a user asks a side-question mid-setup? (drives [4] design)
4. Is `MasterAgentOutcome` the PERMANENT proposal contract or a v1 placeholder? (decides scope of [8] / P1b)
