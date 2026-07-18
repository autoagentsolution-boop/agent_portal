# 06 — Technical Debt & Improvements

Synthesised from docs 01–05, 07–08 plus direct measurement of `pivot/video-content-farm` (2026-07-18).

Confidence marking: **[verified]** = I confirmed it against the code/tree myself · **[reported]** = from a scanning agent, not independently re-checked.

Priority: **P0** = blocks a paying tenant · **P1** = this quarter · **P2** = backlog · **P3** = declined, see §6.

---

## 0. Design decisions that are NOT debt

Recorded here because a scan reads them as gaps. They are deliberate and correct.

| Behaviour | Why it looks like a gap | Why it is not |
|---|---|---|
| **DRY-RUN publish on the autonomy cron path** (`autonomy-runner.ts:22-27,55`) | "The autonomous loop never posts anything" | DRY-RUN is the test posture — it exercises the full loop without burning a real platform write. Real publishing is not the thing being tested there. Turning it live is a config decision, not engineering work. |
| **Autonomy grant executes the whole flow** (`approval-policy.ts:36-53`) | Machine-approving a publish gate looks like an agent deciding to post | The human double-confirmed this specific flow upfront. `atriaApprovalPolicy` never decides *to* publish — it only verifies the guardrails still hold (`connected && mediaReady && cleanlyPostable && contentChecksPass`) and otherwise parks + notifies. Authorization came from the human; the policy is a checker, not a decider. |
| **`schedule` gate always returns `hold`** (`approval-policy.ts:55-59`) | Reads as "autonomy can't be trusted with scheduling" | It is the halt mechanism that makes scheduling work. Atria must **not** be able to bypass a scheduling requirement and publish immediately. The hold is how the run waits for the right instant, not a vote of no confidence. |
| **Prompt bodies embedded in TS** (`prompts/*.ts`, ~616 lines) | Looks like config trapped in code | Keeps type-checking and lint coverage on template variables, and keeps prompts under code review with their golden tests. Extracting to `.txt` would lose all of that. See doc 03 §1. |

Do not "fix" these. If an external doc or demo describes them wrongly, fix the doc.

---

## 1. Baseline measurements

| Metric | Value |
|---|---|
| Backend | 34,577 LOC · 309 `.ts` files **[verified]** |
| Frontend | 12,474 LOC · 74 files (3,127 = generated `schema.d.ts`) **[verified]** |
| Registered agent nodes | 18, all deterministic **[reported, high confidence — per-node scorecard with file:line in doc 05 §5.2]** |
| True agentic loops | 2 — `atria-brain.ts`, `nurture-brain.ts` |
| Gates / guardrails | ~55 across 6 categories |
| Prisma migrations | 49 **[verified]** |
| `verify-*.ts` scripts | 83 **[verified]** |
| Unit/integration tests | **0** **[verified]** |
| CI pipelines | **0** **[verified]** |
| `console.*` calls | 490 **[verified]** |
| `TODO`/`FIXME` markers | 0 **[verified]** |

Zero TODO markers alongside substantial known debt means debt is recorded in `plans/` and in people's heads, not in the code. Anyone reading a file cannot see what's deferred in it.

---

## 2. P0 — blocks a paying tenant

### 2.1 No automated test execution, no CI

**Evidence [verified]:** 0 `.test.ts`/`.spec.ts` files. `package.json` scripts are `dev`, `start`, `typecheck`, `prisma:generate`, `prisma:migrate`, `prisma:deploy`, `gen:openapi` — no `test`. No `.github/workflows`.

**What exists:** 83 `verify-*.ts` scripts, each independently executable, each self-reporting. These encode real integration behaviour and are genuinely valuable — the problem is purely that nothing runs them together.

**Why P0:** The project's own rule ("run tests before push, DO NOT ignore failed tests") is currently unenforceable. In practice a subset gets run, chosen by whoever remembers which ones are relevant. `planner-golden-snapshot.json` — the single artifact protecting planner determinism — has no automatic trigger.

**Fix:**
1. A runner script that globs `verify-*.ts`, executes each, aggregates results, exits non-zero on any failure. ~40 lines. Needs no test framework — the scripts already self-report. Add as `npm run verify`.
2. GitHub Actions: `typecheck` + `npm run verify` on push. Needs a Postgres service container (several verify scripts hit the DB).
3. Only then consider Vitest, and only for new code.

**Effort:** S for 1+2, M for 3. **This is the highest-leverage item in the document** and it gates §3.1 and §3.2.

### 2.2 No structured logging or run correlation

**Evidence [verified]:** 490 `console.*` calls. No `pino`/`winston`/OpenTelemetry in `dependencies`. A `src/lib/logger.ts` exists and is used in places (`autonomy-runner.ts:17,60,63`) but is not universal.

**Why P0:** A run spans HTTP → planner → executor → N node runners → connector → external API, and can **park for days** then resume via cron in a different process. When a tenant asks "why didn't my post go out", reconstructing that from unstructured stdout across that lifespan is impractical. Support has no answer path today.

**Fix:** Thread a context object (`runId`, `tenantId`, `nodeId`) through the executor and attach the logger to it. The executor already passes `ctx` — this is exactly the seam `thinking-budget.ts` used to bind per-agent budgets with zero per-runner edits. Do **not** hand-edit 490 call sites; convert the ~30 on the run path and standardise on `lib/logger.ts` for new code.

**Effort:** M.

### 2.3 ~~Two fail-open guardrails~~ — **VERIFIED 2026-07-18, both DOWNGRADED out of P0**

Both were reported as P0 fail-open risks. Reading the code shows the phenomena are real but the severity was overstated in both cases. Kept here (rather than deleted) so the next scan doesn't re-raise them.

**Kill switch — real fail-open in code, unreachable on the publish path. → P2.**

`system/kill-switch.ts:26-30` genuinely returns `false` (fail open) when the `SystemFlag` read faults. A 3s in-process cache (`:14-20`) means the practical scenario is: ops toggles the switch → DB dies → external actions resume ~3s later.

But trace the publish path in `connectors/runtime/connector-runtime.ts`:

| Line | Step | Behaviour on DB fault |
|---|---|---|
| 77 | `isExternalActionsPaused()` | fails **open** → proceeds |
| 94 | `findPriorSuccess()` — idempotency read, **not** wrapped in try/catch | **throws** → publish never happens |
| 108 | `publishTo()` — the actual wire call | unreachable |

`runtimePublishFn:147-153` — the shim the executor's publisher travels — **always** supplies `idempotencyKey`, so line 94 always executes on the real publish path. A DB outage therefore blocks the publish two lines after the kill switch failed open. The fail-open is not exploitable as an unwanted-publish vector today.

Residual risk is latent, not live: it becomes real the day someone adds an `invokeAction` caller **without** an idempotency key. Fix anyway — it's ~3 lines to cache last-known-value and fail closed at `:29`, and it removes a trap for a future contributor. **Effort S, priority P2.** Secondary note: `findPriorSuccess` throwing violates `invokeAction`'s documented "never throws" contract (`:141`) — separate, minor.

**Rate limiter — not a defect. Documented deliberate deferral. → not debt, a scaling precondition.**

`rate-limit-manager.ts:7-10` already states it plainly: *"in-memory + single-process… NOT a distributed limiter. Multi-instance deploys need a shared store (Redis) — deferred, since the demo runs one process and publishing is DRY."* It is correct within one process. This is not fail-open; it is a known precondition. Move it to the deployment checklist: **shared-store limiter is a hard blocker on running a second instance**, and the blast radius if missed is a Meta/X ban (memory: `feedback_no_burst_social_posts`). Effort M, triggered by the scaling decision, not by the calendar.

### 2.4 No HTTP hardening

**Evidence [verified]:** no `helmet`, no inbound rate limiting anywhere in `src`. The only rate limiter is *outbound* (connector runtime).

**Why P0:** LLM-backed routes behind `requireAuth` are a cost-amplification target — one compromised session can burn credits at machine speed. The credit gate caps total damage per tenant but places no ceiling on rate. Auth routes have no throttle at all.

**Fix:** `helmet` + per-IP throttle on auth routes + per-user throttle on LLM-backed routes. Effort S.

---

## 3. P1 — structural debt

### 3.1 File-size violations against the project's own rule

`.claude/rules/development-rules.md` mandates <200 lines. Actual **[verified]**:

| File | LOC | × limit |
|---|---|---|
| `src/orchestration/executor/agent-runners.ts` | 1,237 | 6.2× |
| `src/api/orchestration-router.ts` | 947 | 4.7× |
| `src/db/repos/workflow-run-repo.ts` | 750 | 3.8× |
| `src/orchestration/executor/workflow-executor.ts` | 536 | 2.7× |
| `src/api/posts-router.ts` | 489 | 2.4× |
| `web/src/components/OrchestratePanel.tsx` | 522 | 2.6× |

`agent-runners.ts` is the one that matters. It is simultaneously the largest file, the highest-churn file, and *the reason nodes are code rather than config* (doc 07 §3.1, doc 08). Split it one runner per file — the registry already provides the boundary. Effort M. **Do §2.1 first**: refactoring the highest-churn file in the system without a one-command regression check is how silent breakage gets in.

### 3.2 Nodes are functions, not sub-agents

Doc 05 §5.2: of 18 nodes, none declare tools, none have cross-invocation memory, none decide their next step, none self-correct. Four (`concept_writer`, `email_writer`, `dm_writer`, `greeting_writer`) don't even use the registry's `promptSections` — they carry flat hardcoded prompt strings, inconsistent with the shared `buildAgentPrompt` path.

That inconsistency alone is worth fixing regardless of any agentic ambitions — it's a DRY violation in the prompt layer.

The larger question (which nodes *should* become sub-agents, and how) is designed out in **doc 08**. Read that before scheduling work here.

### 3.3 Sequential DAG execution

The executor runs nodes sequentially. Independent work — per-platform copy variants, per-slot calendar content, multi-source research — is serialised for no reason. Doc 07 Option C. Cheapest user-visible win (latency), orthogonal to everything else. Breaks to handle: SSE event ordering, cost rollup, park/resume interaction. Effort M.

### 3.4 Single-region hardcoded defaults **[reported — doc 03, with file:line]**

| Item | Spread | Impact |
|---|---|---|
| `Asia/Bangkok` default timezone | ~10 files | A US/EU tenant's "9am" silently posts at the wrong local hour — and the schedule gate exists precisely to mitigate timezone risk. |
| `['facebook']` platform fallback | **6 production files / 8 call sites [verified]** — `intake-provider.ts:116`, `campaigns-router.ts:75`, `orchestration-router.ts:612`, `agent-runners.ts:233,240,482`, `campaign-from-flow.ts:34`, `campaign-materializer.ts:29`. All the same `x.length ? x : ['facebook']` shape. (~70 further grep hits are `verify-*.ts` test fixtures — ignore them. `fb-insights.ts:109` is an insights source label, NOT a fallback.) | **Not a publish-safety issue** — the connection gate parks the run at `needs_connection` before anything goes out. The damage is UX: a tenant connected only to Instagram who doesn't name a platform is asked to connect Facebook. Two separable defects: **(a)** the literal is duplicated 8× so changing the default means 8 edits and one miss silently diverges the campaign path from the run path; **(b)** the semantics are wrong — it should fall back to the tenant's *connected* platform, not a fixed one. |
| Platform asset-support matrix | duplicated FE + BE, sync enforced by a comment | Drift produces a UI that offers a publish the backend rejects. |
| Lead hot/warm/cold thresholds | FE-only, disconnected from backend `LeadScoringCriteria` | Two sources of truth for one business rule. |

**Sizing, corrected 2026-07-18 after reading the call sites:** the `facebook` fallback was initially grouped with the P0 security items — that was wrong, it is not a safety defect (the connection gate catches it). Split it:

- **(a) Extract `DEFAULT_PLATFORM_FALLBACK` and use it at all 8 sites** — pure DRY, no behaviour change, no test impact. S. Do it opportunistically, not urgently.
- **(b) Fall back to the tenant's first connected platform** — this is the semantically correct fix and the one users would actually feel. M, and it *changes behaviour*, so it needs its own verify script. Note the golden-snapshot fixtures pass `platforms` explicitly, so `verify-planner-golden` should be unaffected — confirm that rather than assume it.

The FE/BE asset-support matrix is the genuine single-constant extraction — S. Timezone is M and follows doc 03's per-tenant tier.

### 3.5 Asset/platform precondition not validated before spend — **P1, measured, top failure mode**

**[verified 2026-07-18 by direct query against the dev DB — 191 runs / 358 node executions]**

| Failure | Count | Nature |
|---|---|---|
| Facebook publish rejected: post has no image, connector requires `assets` | **4** | Deterministic precondition |
| Veo `429` quota exceeded | 1 | External quota |
| Prisma `artifact.create()` invocation error | 1 | Code defect |
| **Malformed LLM output (schema parse failure)** | **0** | — |

Exact errors:
```
publisher: publish did not complete (facebook:missing required input(s): assets)
publisher: publish did not complete (no target platform can publish this post: facebook (facebook: no asset (image)))
```

**Two conclusions, both actionable:**

1. **The dominant failure mode is a checkable precondition, not model flakiness.** A text-only post planned for Facebook is knowably unpublishable *before the run spends a token*. `approval-policy.ts:22` already defines `cleanlyPostable` for precisely this check, but these runs reached the publisher and threw — the guardrail exists on the granted path and evidently isn't applied on the path these runs took. This is the "text-only post can't publish" issue on record since 2026-07-08, now quantified as **4 of 6 of all observed failures**.

2. **It costs real money.** Failed runs bill the tenant $0 (`workflow-executor.ts:119`, product decision 2026-07-15) but still consume tokens:

   | Run status | Runs | Tokens | USD |
   |---|---|---|---|
   | completed | 26 | 77,005 | $3.4525 |
   | needs_approval | 11 | 34,444 | $0.1044 |
   | **failed** | **6** | **7,075** | **$0.2099 — unbilled** |

   ~5.6% of all LLM spend in this database was burned on runs nobody paid for. Small in absolute terms (dev data), but the ratio is the signal, and ~2/3 of it is one preventable cause.

**Fix:** validate the asset↔platform matrix at plan time and refuse/repair the plan before execution, rather than discovering it at the publisher. Ties directly to §3.4's FE/BE matrix duplication — the same matrix, enforced in a third place. Effort M. **This is better-evidenced than most of the P1 list and should outrank it.**

**Corollary — doc 08's headline recommendation is dead.** That doc proposed a bounded self-repair wrapper for malformed LLM output, and honestly flagged that the failure rate was unmeasured. Measured: **0 of 358**. Self-repair would fix zero observed failures. Do not build it. See the banner at the top of doc 08.

### 3.6 Credit double-count — tenants over-debited ~2.4–2.8× on LLM nodes — **P0, verified on live data**

**[verified 2026-07-18 by direct query]**

`workflow-run-repo.ts:306`:
```js
return creditsFromTokens(totalTokens) + creditsFromUsd(costUsd);
```

Both terms bill the same LLM call. `nodeAgg._sum.costUsd` sums **all** `cost_usd`, and an LLM node's `cost_usd` is *derived from* that node's own `totalTokens` (`node-cost.ts:52-60,64-72`). So an LLM call is charged once via its token count and again via the USD those tokens produced.

The intent is documented and is narrower than the implementation — `credits.ts:14-16` states `creditsFromUsd` exists to capture **media** spend, which bills USD with **zero** tokens and would otherwise be invisible. It was never meant to re-bill LLM USD.

Measured on pure-LLM agents (no media contamination):

| Agent | credits from tokens | credits from USD | **debited** | actual cost in credits | overcharge |
|---|---|---|---|---|---|
| `ideation` | 104 | 74 | **178** | 74 | 2.4× |
| `strategy` | 75 | 42 | **117** | 42 | 2.8× |
| `concept_writer` | 81 | 59 | **140** | 59 | 2.4× |

DB-wide the token term adds **479 credits (~20%)** on top of the USD term. This is not a display artifact — `workflow-executor.ts:122-123` passes `runCredits` straight into `reconcileRunDebit`, which debits the real wallet.

### ✅ FIXED 2026-07-18 — `workflow-run-repo.ts:299-307`

`runCredits` now returns `creditsFromUsd(costUsd)` — a single, complete, non-overlapping measure. Option (b) (restrict the USD term to media) was investigated and **rejected on evidence**: `wf_node_run.cost_usd` is a blended column (`sumCost`, `node-cost.ts:103-108` merges LLM planning + N media generations into one row), and the `mkt_llm_usage` ledger cannot stand in for the LLM half — a per-run join yields *negative* implied media cost, so it over-counts.

**Historical reconciliation — nothing to refund.**

| Account | Granted | Debited | Balance |
|---|---|---|---|
| `p6-demo-…@test.local` (throwaway test tenant) | 20,000 | **114** | 19,886 |
| `auto.agent.solution@gmail.com` | — | — | 2,000 |
| `nghiepit.lamthuan@gmail.com` | — | — | 2,000 |

Every debit ever written landed on one disposable test tenant: 5 runs, **114 credits charged vs 52 correct — 62 over-charged, 2.2×**. Both real accounts hold an untouched 2,000-credit trial and have never been debited. **Fix forward; no ledger migration, no refund.** Had a paying tenant existed, this would have required a reconciliation entry per affected run.

**Verification:** `tsc --noEmit` clean · `verify-credits` PASS · `verify-credit-wallet` ALL GREEN · `verify-llm-usage` PASS · `verify-impact` PASS. `verify-flow-cost-rollup` **not run** — requires a live server on :7100; it exercises the display path (`creditsFromTokens` at `:285,:355`), which this change does not touch.

Two test fixtures were corrected, both encoding assumptions that the fix invalidated — neither was relaxed to pass:
- The wallet test asserted `creditsFromTokens(3000) + creditsFromUsd(0.04)` — i.e. it encoded the double-count itself. Expectation updated to the correct formula, plus a new assertion that the new value is strictly lower than the old.
- A fixture set `totalTokens: 1000, costUsd: 0`, describing a node that cannot exist (`costFromUsage` prices every token at a positive rate). Confirmed against live data: **0 rows** in `wf_node_run` have `total_tokens>0 AND cost_usd=0`. Set to a realistic $0.0025.

**Still open:** display surfaces (usage dashboard, impact report, plan-tier cards) continue to present the token-passthrough scale, so a displayed credit figure will not match the debit. Read-only, no money impact, but it will confuse a user comparing the two. Aligning them touches 4 call sites + their verifies — separate change.

---

**Original analysis — fix options considered:**
- **(a) Single source, USD-based:** `creditsFromUsd(totalUsd)`. Simplest, provably correct, and naturally handles media. Changes displayed credit numbers for every historical run.
- **(b) Keep token passthrough, restrict the USD term to media:** requires separating media USD from LLM USD at write time (`wf_node_run` currently stores one blended `cost_usd` because `sumCost` merges them, `node-cost.ts:103-108`). More faithful to the documented "token passthrough" intent; more work.

**(a) is the recommendation** — the token anchor's own premise is already broken independently: `TOKENS_PER_CREDIT` prices every token at the flash **output** rate ($2.50/1M), so a prompt-heavy run is overcharged even without the double-count. Measured per-agent rates run $1.40–$2.01/1M actual against a $2.50/1M assumption.

**Migration:** existing `mkt_credit_ledger` rows were written under the buggy formula. Decide explicitly whether to reconcile historical balances or only fix forward, and record that decision — it's a billing question, not an engineering one. Effort S for the formula, M with reconciliation.

**Note:** `cost_usd` itself is **correct** — verified by hand against `ideation` (8,497 in / 17,452 out on flash → `8497×0.30/1M + 17452×2.50/1M = $0.04618`, matching the stored value exactly). Input, cached, output, and Gemini thinking tokens are each priced at their own rate per model tier (`node-cost.ts:32-60`). The defect is confined to the credit layer above it.

### 3.7 Capability shipped without provisioning **[reported, doc 04]**

DM (WhatsApp/Telegram/Zalo) and public greeting nodes are code-complete with passing verify suites, but have **never executed a live send** — no channel tokens provisioned in any deployment. This is not an engineering defect; the fail-closed `ENABLE_LIVE_*` gating is correct and deliberate.

It is a **carrying-cost** question: that code needs maintenance, and every refactor above must keep it green, for a capability with no delivery date. Decide whether tokens are being procured; if not, consider freezing it rather than carrying it.

---

## 4. P2 — backlog

| Item | Rationale |
|---|---|
| Vietnamese-first hardcoded UI copy | Real i18n matters at the first non-VN tenant. Track it; don't pre-build it. |
| `TRIAL_CREDITS`, 8 cron literals, image/TTS model IDs, Veo per-second cost → env vars | `src/config/env.ts` is already a strong Zod-validated baseline; these should follow that existing pattern but don't. Mechanical, low value each — do opportunistically when touching the file. |
| Debt invisible in code (0 TODOs) | Adopt a light convention for genuinely deferred items so the next reader sees them. |
| 49 migrations, no squash | Not a problem yet. Becomes one if cold-start migration time affects deploys. |

---

## 5. Sequencing

```
2.4 helmet + throttle ──────── the ONLY urgent safety item left after verification
3.5 asset/platform precheck ── best-evidenced item in the doc (4 of 6 real failures), M
2.3 kill-switch fail-closed ── P2, S, do opportunistically (not exploitable today)
2.3 shared-store limiter ───── blocked on the scaling decision, not the calendar
3.4a facebook constant + matrix ─ independent, S each, opportunistic (NOT urgent — no safety impact)
3.4b connected-platform fallback ─ M, behaviour change, needs its own verify

2.1 verify-runner + CI ──┐
                         ├──→ 3.1 split agent-runners.ts ──→ 3.2 / doc 08 ──→ 3.3 parallel fan-out
2.2 structured logging ──┘
```

**After verification, P0 is thinner than the first draft claimed.** Of the four originally-listed P0 items, two (2.3's pair) collapsed on inspection — one was unreachable, one was a documented deferral. What survives is **2.1 (test/CI), 2.2 (logging), 2.4 (helmet/throttle)** — and notably all three are items measured directly rather than reported by a scan. Only 2.4 is a same-week safety fix; 2.1 is the highest-leverage item overall. The chain through 3.1 is the quarter of work, and **2.1 must land before it starts**.

---

## 6. Declined

| Declined | Reason |
|---|---|
| **Runtime agent spawning (doc 07 Option B)** | Buys composition, not capability. Breaks cost predictability, planner determinism, and the upfront-cost autonomy grant — the three things that make the product trustworthy. Revisit only when 5+ real capability-gap rows prove demand. |
| **Prompt bodies extracted to `.txt`/`.md`** | Loses type-checking and lint coverage on template variables; no test-safety benefit. |
| **Env vars for retry attempts, backoff, Data Guard chunk size (40k), rate-limit floor** | Engineering tuning knobs, not business rules. Per-call-site override already exists where needed. |
| **Speculative i18n framework** | No non-VN tenant exists yet. |
| **Rewriting 83 verify scripts into Vitest** | They work and encode real integration behaviour. Wrap them in a runner (§2.1); don't rewrite them. |

---

## 7. Unresolved questions

1. **Deployment topology** — single-instance today? The rate-limiter fix (2.3) and park/resume both hinge on it; I found no manifest beyond `docker-compose.yml`.
2. **Kill-switch / rate-limiter fail-open [reported]** — verify against code before scheduling.
3. **DM/greeting provisioning** — is a WhatsApp number / Telegram bot / X API tier actually being procured? Determines carry-vs-freeze (§3.5).
4. **Postgres backup/retention** — leads carry encrypted PII; no backup configuration found in the repo.
5. **When does the autonomy cron path go live** (DRY → real publish)? It's a config flip, but it should be a deliberate, dated decision with a tenant to test on.
