# 09 — What Can Be Done Today

Filtered from docs 01–08. Inclusion criteria: **self-contained, low blast radius, verifiable the same day, no cross-team decision required.** Anything needing a product/billing/scaling decision is in §4, not here.

Ordered by (value ÷ effort). Sizes assume one engineer familiar with the codebase.

---

## 1. Done today already

| # | Item | Status |
|---|---|---|
| 0 | **Credit double-count fix** (`workflow-run-repo.ts:299-307`) + historical reconciliation | ✅ Shipped. `tsc` clean, 4 verify suites green. No real tenant affected — every debit landed on one test account. See doc 06 §3.6. |

---

## 2. Ship today — high value, contained

### 2.1 `npm run verify` — a runner for the 83 verify scripts · **~1h** · doc 06 §2.1

The single highest-leverage item in the whole document set, and it is an afternoon.

83 `verify-*.ts` scripts exist, each self-reporting, and **nothing runs them together**. There is no `test` script in `package.json`. Today's credit fix had to be validated by invoking four scripts by hand and reading their tails — that is the current state of the art for every change.

```
Glob src/**/verify-*.ts → run each → aggregate → exit non-zero on any failure
```

Notes from doing it manually today: some scripts need a live server on :7100 (`verify-flow-cost-rollup`) and some need only Postgres. **Tag them into two tiers** — `verify:db` and `verify:http` — so the DB tier can run without booting the app. Do not try to make the HTTP tier work today.

**Acceptance:** `npm run verify:db` runs every non-HTTP script and returns 1 if any fails.

### 2.2 `helmet` + auth-route throttle · **~1h** · doc 06 §2.4

The only genuinely urgent safety item surviving verification. No `helmet`, no inbound rate limiting anywhere (`src`'s only limiter is *outbound*). LLM-backed routes behind `requireAuth` are a cost-amplification target: the credit gate caps total damage per tenant, nothing caps the rate.

`npm i helmet express-rate-limit` → `app.use(helmet())` in `server.ts` → per-IP throttle on `/auth`, per-user throttle on LLM-backed routes.

**Acceptance:** a burst of 100 auth requests from one IP gets 429s; `/health` unaffected.

### 2.3 Kill-switch fails closed · **~15 min** · doc 06 §2.3

`system/kill-switch.ts:26-30` returns `false` (fail **open**) when the `SystemFlag` read faults. Verified today: not exploitable on the publish path, because `findPriorSuccess` (`connector-runtime.ts:94`, unguarded) throws two lines later and `runtimePublishFn:152` always supplies an idempotency key. So this is **not** urgent — but it is 15 minutes and it removes a trap for whoever next adds an `invokeAction` caller without a key.

Cache the last-known value; on read fault return the cached value, or `true` if there is none.

**Acceptance:** a test that forces the read to throw and asserts the call returns paused.

### 2.4 `DEFAULT_PLATFORM_FALLBACK` constant · **~30 min** · doc 06 §3.4a

`['facebook']` is duplicated across **6 production files / 8 call sites** (`intake-provider.ts:116`, `campaigns-router.ts:75`, `orchestration-router.ts:612`, `agent-runners.ts:233,240,482`, `campaign-from-flow.ts:34`, `campaign-materializer.ts:29`). Pure DRY, no behaviour change.

Do **not** also change the fallback semantics today — falling back to the tenant's *connected* platform is a behaviour change that needs its own verify (§4).

**Ignore the ~70 other grep hits** — they are `verify-*.ts` fixtures. `fb-insights.ts:109` is an insights source label, not a fallback.

**Acceptance:** one exported constant, 8 call sites updated, `tsc` clean, golden snapshot unchanged.

---

## 3. Ship today if there's room

### 3.1 Route the four orphan writers through `buildAgentPrompt` · **~2h** · doc 06 §3.2

`concept_writer`, `email_writer`, `dm_writer`, `greeting_writer` carry flat hardcoded prompt strings instead of the registry's `promptSections` that every other node uses (doc 05 §5.2). A DRY violation in the prompt layer, independent of any sub-agent ambitions.

**Risk:** prompt text changes → output changes → golden snapshot may move. Do this **after** 2.1 exists so the regression check is one command. If the snapshot moves, stop and inspect rather than re-baselining.

### 3.2 Structured logging on the run path only · **~2h** · doc 06 §2.2

Full conversion is M and not a today job — 490 `console.*` calls. But the *seam* is a today job: attach a logger carrying `runId`/`tenantId`/`nodeId` to the executor's `ctx`, exactly as `thinking-budget.ts` binds per-agent budgets with zero per-runner edits. Convert the ~30 call sites on the run path; leave the rest.

Pays for itself the first time someone asks why a run failed.

### 3.3 Record the deferred items as code comments · **~30 min** · doc 06 §4

Zero `TODO`/`FIXME` markers exist alongside substantial known debt — it all lives in `plans/` and in people's heads. Anyone reading a file cannot see what is deferred in it. Add markers for the handful of genuinely deferred items surfaced in these docs (single-process rate limiter, blended `cost_usd` column, display-vs-debit credit scale mismatch).

---

## 3.5 Known-red HTTP scripts (as of 2026-07-18)

The http tier runs 11/14 green. The three reds are diagnosed, none caused by the runner, and all predate it — they simply had no automated path before. Recorded here so a red suite is not mistaken for a new break.

| Script | Symptom | Diagnosis |
|---|---|---|
| `verify-campaign-reuse-http` | **Flaky** — 1 pass / 2 fail across 3 consecutive runs. "refine stays on the SAME draft run" fails; a fresh run id appears | Server log during the failures: `atria_brain_empty_content` ×3 → `atria_brain_degraded` ×3. Live Gemini intermittently returns `""` (a known quirk, see memory `project_orchestrate_conversational_unify`), the brain degrades to the deterministic path, and **that path forks a new run instead of refining in place**. This is the same user-visible failure class that `project_atria_campaign_flow_confusion_fix_260713` fixed for a different trigger: "Atria lost my context and made a new flow." The test is honest; the degraded path is the problem. |
| `verify-api` | Hangs — still running past 300s (exit 124), plus 3 red checks: publisher gate not reached, and `thin product → awaiting_clarification` returning `planned` | Clarification not triggering, also LLM-dependent. The hang is undiagnosed. |
| `verify-connect-form` | `getActiveToken: facebook needs re-auth (status=needs_attention)` | Test writes a FAKE token to a throwaway tenant via the form endpoint, then expects `getActiveToken` to return it through the vault fallback. Instead a record with `status=needs_attention` is found. This is about the **vault-fallback path**, not about real account credentials — using a real/superadmin account would not exercise what this test targets. Needs a behavioural answer: should a form-saved credential produce a record in that state? |

Two of the three are LLM-dependent, which makes them structurally flaky. Worth deciding whether such tests belong in a blocking gate at all, or in a separate advisory tier.

## 4. NOT today — needs a decision or a bigger change

| Item | Blocked on | Doc |
|---|---|---|
| ~~Asset/platform precondition check~~ — **RETRACTED**, already fixed by `413fef0` (Fix D) on 2026-07-08. All 4 failures predate it, the last by 4 minutes. | Nothing to do. See doc 06 §3.5 for the retraction and the measurement error behind it. | 06 §3.5 |
| Connected-platform fallback (replacing the fixed `facebook`) | Behaviour change, needs its own verify script | 06 §3.4b |
| Align display credit scale with the debit scale | 4 call sites + verifies; also a product call on whether displayed numbers may shift | 06 §3.6 |
| Split `agent-runners.ts` (1,237 lines, 6.2× the project's own limit) | Requires 2.1 to land first — highest-churn file in the system | 06 §3.1 |
| Shared-store rate limiter | Triggered by the decision to run a second instance, not by the calendar | 06 §2.3 |
| Self-repair wrapper for malformed LLM output | **Do not build.** Measured 0 of 358 node executions. | 08 banner |
| Runtime agent spawning | Declined — buys composition, not capability; breaks cost predictability and determinism | 07 |
| DM / greeting go-live | No channel tokens provisioned; carry-vs-freeze is a product call | 06 §3.7 |
| Timezone per-tenant | M, follows doc 03's config tier | 03 |

---

## 5. Suggested order for one day

```
morning    2.1 verify runner  →  2.3 kill-switch (15m)  →  2.4 facebook constant (30m)
afternoon  2.2 helmet + throttle  →  3.2 logging seam (if room)
end        run `npm run verify:db` — the thing 2.1 just built — over everything above
```

2.1 goes first specifically so everything after it is validated by one command rather than by hand.

---

## 6. Unresolved — needed before §4 can be scheduled

1. **Deployment topology** — single instance today? Gates the rate-limiter item and the park/resume assumptions. No manifest found beyond `docker-compose.yml`.
2. **Postgres backup/retention** — leads carry encrypted PII; no backup configuration found in the repo.
3. **DM/greeting provisioning** — is a WhatsApp number / Telegram bot / X API tier actually being procured?
4. **Autonomy cron go-live date** — DRY → real publish is a config flip, but should be deliberate and dated, with a tenant to test on.
