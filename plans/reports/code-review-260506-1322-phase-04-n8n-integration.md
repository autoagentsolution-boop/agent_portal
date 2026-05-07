# Phase 04 — n8n Integration + Core Loop — Code Review

**Reviewer:** code-reviewer
**Date:** 2026-05-06
**Scope:** Backend Phase 04 changes (n8n module, run/callback loop, retry path)

---

## 1. Verdict

**APPROVE_WITH_FIXES — 7.5 / 10**

Functionally complete and matches spec §11.3 / §11.4 / §12.2. Two issues worth addressing before demo (one correctness, one operational), three deliberate trade-offs are sound for a 3-week demo. No blockers.

---

## 2. Critical (must fix)

### C1. `runAgent` synchronous trigger failure path leaves execution stuck in `running` forever

`agents.service.ts:194` calls `this.n8n.triggerWorkflow(...)` which is fire-and-forget. The trigger can fail in two distinct windows:

1. **Synchronous** — DNS/connect refused, `fetch` throws before promise resolution → swallowed in `.catch()` and only logged.
2. **Async** — n8n returns non-2xx → logged as `warn`, no DB transition.

In both cases the `Execution` row stays at `status='running'` indefinitely. The frontend will poll forever, the demo UX is broken, and there is no path to recovery short of a manual SQL update.

You explicitly called this out in the prompt — yes, it should transition to `error`/`failed` on synchronous trigger failure. Lowest-effort fix that respects KISS:

```ts
// n8n.service.ts — return the in-flight promise instead of void
triggerWorkflow(webhookPath: string, payload: N8nTriggerPayload): Promise<void> {
  // ... existing code, but return the chain
  return fetch(...)
    .then((res) => { if (!res.ok) throw new Error(`n8n ${res.status}`); })
    .finally(() => clearTimeout(timer));
}

// agents.service.ts — handle rejection without awaiting end-to-end
this.n8n.triggerWorkflow(agent.template.n8nWebhookPath, payload).catch(async (err) => {
  this.logger.error(`n8n trigger failed, marking execution failed: ${err.message}`);
  await this.prisma.execution.update({
    where: { id: execution.id },
    data: { status: 'failed', finishedAt: new Date(), errorMessage: `Trigger failed: ${err.message}` },
  });
});
```

Note: you still want to return the response to the caller immediately (don't await the catch). The `.catch` runs in the background, but at least when n8n is down, the execution row terminates within ~5s instead of hanging.

For demo, this is a 10-line fix that prevents the most likely "broken demo" scenario — n8n container not running.

---

## 3. Concerns (should fix or document)

### S1. `RUNNABLE_STATUSES` includes `running` — parallel executions allowed

`agents.service.ts:16` allows running an agent already in `running` state. This means:
- A user double-clicks "Run" → two `Execution` rows created, two n8n triggers fired.
- A retry on a stuck execution (see C1) creates a parallel one.

For the demo this is mostly cosmetic (no idempotency key from frontend), but it does affect the analytics dashboard and "how many runs" semantics. Two acceptable options:

- **Option A (KISS):** Keep as-is and document that "Run" creates a new execution every click (which actually matches the spec — section 11.3 doesn't gate on prior execution state, only on agent status not being archived).
- **Option B:** Add a single check before creating execution — reject if there's an in-flight execution for this agent (`status IN ('queued','running')`). One extra query.

Recommend Option A + document, unless the frontend will have a "Run" button that's enabled while an execution is mid-flight. If it does, you'll want B to prevent the demo footgun.

### S2. `updateFromCallback` idempotency has a TOCTOU race window

`executions.service.ts:60-74` does:
```ts
const execution = await prisma.execution.findUnique(...)
if (TERMINAL_STATUSES.has(execution.status)) return skip
await prisma.$transaction(... update ...)
```

Two concurrent callbacks for the same `execution_id` (e.g., n8n retries on its side) can both pass the guard and both enter the transaction. The second `update` will succeed and overwrite the first's metrics/output. The duplicate `notification.create` will create two notifications. The duplicate `auditLog.create` will create two audit rows.

For local demo with one n8n instance, callback duplication is unlikely but not impossible (n8n retry on slow ack, network blip). The fix is a conditional update inside the transaction:

```ts
const updated = await tx.execution.updateMany({
  where: { id: execution.id, status: { notIn: ['success','warning','failed','cancelled'] } },
  data: { ... },
});
if (updated.count === 0) {
  // another callback won the race — bail out of the rest of the tx
  return;
}
```

`updateMany` with a status filter gives you DB-level CAS. Roughly 5 lines. Worth doing because the symptom (duplicate notifications) is user-visible if it ever fires.

### S3. `errorMessage` not set when `payload.error` is `null` and status is failed

`executions.service.ts:97`: `errorMessage: payload.error?.message ?? null`. If status is `failed` but `error` is null/missing (workflow crashed before populating), the execution row shows `failed` with no error message. The notification falls back to `result.summary` (line 121), which may also be null. Result: a `critical` notification with `message: null`.

Demo-acceptable, but consider a fallback like `'Execution failed (no error details from workflow)'` when `status === 'failed' && !payload.error`. One line.

### S4. Callback DTO `metrics.estimated_cost_usd` is `number`, schema column is `Decimal`

`callback.dto.ts:18` parses as `number`. Prisma column is `Decimal`. Prisma accepts numbers and converts, but for amounts like `0.0001` you can hit float-precision issues silently. For a demo with mock token counts, this is fine, but worth a one-line comment that the demo intentionally accepts JS-number precision for cost.

### S5. `BACKEND_CALLBACK_URL` and `N8N_CALLBACK_SECRET` fallbacks hide misconfiguration

`agents.service.ts:189-190` uses `?? 'http://backend:4000/api/n8n/callback'` and `?? ''` for the secret. If the env var is missing, the agent is sent an empty secret in the trigger payload. n8n then calls back with empty header → backend rejects 401 → execution stuck running (see C1). The empty-secret fallback is more dangerous than failing fast at boot.

Demo recommendation: in `main.ts` or module init, assert these env vars are set. Three lines, prevents a confusing 60-minute debug.

### S6. `runAgent` doesn't promote `agent.status` from `draft` → `running`

After successfully creating an execution, the agent stays in `draft`. The next call to `runAgent` works (draft is in `RUNNABLE_STATUSES`), so functionally fine, but the agent list UI will keep showing "draft" for an agent that's been run dozens of times. Spec §11.3 step 5 just says "Create execution record with status running" — doesn't mandate agent status change. Document or transition; either is fine.

---

## 4. Trade-offs validated

| # | Trade-off | Verdict |
|---|-----------|---------|
| 1 | **Timing-safe secret compare** (manual XOR loop instead of `crypto.timingSafeEqual`) | OK. Loop is correct (early-return on length mismatch first, but length itself leaks → still standard practice, n8n's secret length is fixed). For demo, fine. Mild preference: use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` after length guard — saves you from ever forgetting `|=` vs `=`. Not worth changing now. |
| 2 | **Header name parsing** (`@Headers('x-demo-callback-secret')`) | OK. Nest lower-cases header keys, so this matches `X-Demo-Callback-Secret` from any client. |
| 3 | **401 path on bad secret** before Zod parse | Correct ordering — don't leak schema errors to unauthed callers. |
| 4 | **Fire-and-forget triggerWorkflow + AbortController timeout** | AbortController correctly aborts; `clearTimeout` in `.finally` prevents leak. The pattern itself is sound. Concern is C1 (no failure propagation), not the fire-and-forget choice. |
| 5 | **AuditLog actor = `agentInstance.createdById`** for callbacks | Acceptable trade-off for demo. The audit row's `action: 'callback_received'` makes it clear this isn't a user action. Production should add a system actor row, but YAGNI. |
| 6 | **forwardRef cycle** (Agents ↔ N8n ↔ Executions ↔ Agents) | Resolves correctly. Nest handles cycles when both sides use `forwardRef` and at least one consumer uses `@Inject(forwardRef(...))` (which `ExecutionsService` does on line 14). `AgentsService` injects `N8nService` directly without `@Inject(forwardRef)` — works because `N8nModule` doesn't depend back on `AgentsModule` directly (only via `ExecutionsModule`). The chain closes through `ExecutionsService.retry → agents.runAgent`. Boot-tested implicitly by the controller wiring; will not throw circular DI. Minor: the cycle is structural debt — `runAgent` doesn't actually need anything from `ExecutionsService`, and `ExecutionsService.retry` could just create the execution row directly and call `n8n.triggerWorkflow` with the same payload-builder helper. Refactoring is YAGNI for demo. |
| 7 | **Zod schema for spec §12.2** | Parses both success and failed payloads correctly. `.partial()` on metrics + `.default(0)` on individual fields is good (handles missing object AND missing keys). `.nullable().optional()` on `result`/`error` matches spec's `null` and missing-field cases. `result.passthrough()` allows arbitrary `data` shapes. Looks good. |
| 8 | **Prisma transaction ordering** in `updateFromCallback` | Order is fine: execution update → output upsert → notification → auditLog. All FKs satisfied because execution row already exists at start (FK targets are valid throughout). If execution.update fails (e.g., row deleted between findUnique and update), entire tx rolls back — no orphan notifications. Good. |
| 9 | **Read-then-update idempotency** | Documented as concern S2 above. Not fatal for demo. |

---

## 5. Other observations

- **`ExecutionsService.retry` doesn't link `retry_from_execution_id`** — spec §11.5 says "Link retry_from_execution_id if field exists". The field doesn't exist in `Execution` model, so nothing to link. Spec-compliant.
- **`durationMs` calc** at `executions.service.ts:78` uses `Math.max(0, ...)` — defensively handles clock skew between n8n and backend. Good.
- **`triggerType` enum** isn't validated anywhere — `runAgent` accepts `'manual' | 'retry' | 'schedule'` typed in TS but the DB column is `String`. Caller boundary is internal only (controllers hardcode `'manual'`, retry path passes `'retry'`), so YAGNI.
- **Workspace scoping on retry** — `executions.service.ts:54` correctly filters by `workspaceId` before passing to `runAgent`, which re-verifies. No tenant leak.
- **No rate limit on `/n8n/callback`** — public endpoint authenticated only by shared secret. For demo on localhost, acceptable. Document as a known demo limitation.
- **Logging includes `executionId`** in n8n trigger logs — good for correlation when debugging.

---

## 6. Unresolved questions

1. **Does the frontend disable the Run button while an execution is in-flight?** Drives whether S1 needs Option B.
2. **Should `runAgent` transition `agent.status` from `draft` → `running` on first run?** (S6) Spec ambiguous; need product call.
3. **Is callback duplication from n8n a real concern in the demo n8n setup?** If n8n's webhook node has retry-on-failure enabled, S2 becomes more important.

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Phase 04 implements the full run/callback loop correctly per spec; one correctness fix (C1: stuck-running on trigger failure) and one race-window fix (S2) recommended before demo. forwardRef DI cycle resolves, Zod schema covers spec §12.2, security model is sound for local demo.
**Concerns/Blockers:** C1 (sync trigger failure leaves execution stuck) is the highest-leverage fix — ~10 LOC, prevents most-likely demo break. S2 (idempotency race) is ~5 LOC and prevents duplicate notifications.
