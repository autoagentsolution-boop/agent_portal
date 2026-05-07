# Gmail Classifier API — Workflow Refinement

**Date:** 2026-05-06 14:35
**Scope:** Refactor `n8n-workflows/gmail-lead-classifier.json` (live id `wvyFRb1dM0QausJp`) to match phase-04 + spec §12 + §14.1 contract.
**Status:** In progress

## Context Links
- Spec §12: n8n workflow contract (request/callback/error)
- Spec §14.1: Gmail Lead Classifier I/O
- Phase 04: `plans/260504-1847-agent-portal-demo/phase-04-n8n-integration-core-loop.md`
- Phase 09: `plans/260504-1847-agent-portal-demo/phase-09-n8n-workflows-4-5-real-integration.md` (sets pattern for siblings)
- Live workflow id: `wvyFRb1dM0QausJp` (currently inactive)
- Backend env: `N8N_WEBHOOK_BASE_URL=http://n8n:5678/webhook`, `N8N_CALLBACK_SECRET=local-demo-secret`, `BACKEND_CALLBACK_URL=http://backend:4000/api/n8n/callback`

## Problem Statement

Current workflow is a **real Gmail organizer** (Gmail Trigger every 1m → Code preprocess → LangChain Text Classifier on Gemini → six Gmail-label-add nodes). It contains an **orphan webhook** at path `/webhook/gmail-email-classifier` that connects to nothing. This violates phase-04 contract in three ways:

1. Webhook path mismatch — seed expects `/webhook/gmail-lead-classifier`.
2. Trigger model wrong — backend triggers via webhook; Gmail Trigger is irrelevant for demo.
3. Output taxonomy wrong — produces label-add side effects, spec demands `classifications[].lead_type` JSON callback.
4. Missing callback — no HTTP Request node calling `payload.callback.url`.
5. No failure-simulation path (phase-09 demo requirement).

## Decision

**Replace** the workflow body with a spec-compliant mock pipeline. **Preserve** the original real-Gmail flow as `n8n-workflows/gmail-real-organizer.json` for post-demo evolution.

Rationale: demo determinism, no OAuth/Gemini dependency at demo time, exact §14.1 taxonomy, simple `simulate_failure` short-circuit. Hybrid was rejected because remapping Gemini's free-form text categories into strict `hot_lead|warm_lead|cold_lead|not_relevant` adds fragility without demo benefit. AI can be reintroduced as an optional branch later (out of scope here).

## Target Architecture

```
Webhook (POST /webhook/gmail-lead-classifier, no auth — backend is trusted)
  → Code "Process & Classify"
      • Validate required fields (execution_id, callback.url, callback.secret)
      • Mock fallback when input.items empty (3 sample lead emails)
      • simulate_failure short-circuit → emits failed callback shape
      • Keyword heuristic → lead_type + score + reason + recommended_action
      • Build §14.1 result + §12.2 metrics
      • Emit { callbackUrl, callbackSecret, callbackBody, httpResponse }
  → HTTP Request "Callback Backend"
      • Method POST, URL = {{ $json.callbackUrl }}
      • Header x-demo-callback-secret = {{ $json.callbackSecret }}
      • Body = $json.callbackBody (JSON)
      • neverError + timeout 5s — never block respond on backend latency
  → Respond to Webhook
      • { received: true, execution_id, status }
```

Single linear chain. Three nodes inside the workflow body. Easy to read, easy to test, easy to fail-simulate.

## Contract Surfaces

### Inbound (spec §12.1)
```json
{
  "execution_id": "exec_xxx",
  "agent_instance_id": "agent_xxx",
  "template_id": "gmail_lead_classifier",
  "workspace_id": "workspace_xxx",
  "config": { "lead_score_threshold": 75, "simulate_failure": false },
  "selected_integrations": ["gmail"],
  "input": { "mode": "test", "items": [] },
  "callback": { "url": "...", "secret": "..." }
}
```

### Outbound callback (spec §12.2 + §14.1 result)
```json
{
  "execution_id": "...",
  "agent_instance_id": "...",
  "template_id": "gmail_lead_classifier",
  "status": "success",
  "n8n_execution_id": "$execution.id",
  "started_at": "ISO",
  "finished_at": "ISO",
  "metrics": {
    "input_count": 3, "output_count": 3, "error_count": 0,
    "tokens_input": 0, "tokens_output": 0, "estimated_cost_usd": 0
  },
  "result": {
    "summary": "3 leads classified. 1 hot, 1 warm, 1 cold.",
    "data": {
      "items_processed": 3,
      "classifications": [
        { "lead_type": "hot_lead", "score": 88, "reason": "...", "recommended_action": "..." }
      ],
      "summary": "..."
    }
  },
  "error": null
}
```

### Failure simulation (config.simulate_failure === true)
```json
{
  "status": "failed",
  "error": { "code": "MOCK_PROVIDER_TIMEOUT", "message": "Simulated provider timeout", "retryable": true }
}
```

## Heuristic (deterministic, no AI)

| Signal in `subject + body` | Score boost | Bucket |
|----------------------------|-------------|--------|
| `pricing`, `quote`, `buy`, `purchase`, `demo`, `urgent` | +50 | hot |
| `interested`, `learn more`, `evaluate`, `trial`, `roadmap` | +30 | warm |
| `unsubscribe`, `newsletter`, `noreply` | -100 | not_relevant |
| (default) | +10 | cold |

Final bucket: `>= 75 hot`, `>= 50 warm`, `> 0 cold`, `<= 0 not_relevant`. Threshold honors `config.lead_score_threshold` for hot cut-off.

## Operational Concerns

- **Idempotency:** backend's `updateFromCallback` already does CAS on `status IN (queued,running)` — duplicate callbacks safe.
- **Timeout:** workflow `executionTimeout: 20s` retained. Linear flow runs in <100ms.
- **Callback failure:** HTTP Request `onError: continueRegularOutput` — Respond still fires; backend retries through `trigger_failed` mechanic if it never receives callback (covered by phase-04 deviation #1).
- **Logging:** rely on n8n Executions UI; no extra log node needed for demo. If backend sees `execution stuck in running > 30s`, that's a callback-miss signal.
- **Callback URL host:** payload value comes from backend env `BACKEND_CALLBACK_URL=http://backend:4000/...`. n8n container reaches backend over the docker network. If backend runs on host (override case), `http://host.docker.internal:4000/...` must be set in `.env` before triggering.

## Security

- Webhook left unauthenticated for the demo (backend network is the trust boundary). For staging, add header-auth credential — flagged as TODO in plan.
- Callback secret transits in payload (n8n → backend). Acceptable inside compose network; would warrant TLS + rotated secrets in non-demo env.
- No PII handling — mock data only. If real Gmail is reintroduced via backup file, snippet logging needs review.

## Files Touched

| File | Action |
|------|--------|
| `n8n-workflows/gmail-lead-classifier.json` | Rewrite (full replace) |
| `n8n-workflows/gmail-real-organizer.json` | Create (backup of prior content) |
| Live workflow `wvyFRb1dM0QausJp` | Update via MCP, then activate |

No backend or frontend changes — seed `n8nWebhookPath` already correct, callback handler already implemented.

## Validation Plan

1. `validate_workflow` (runtime profile) — must return 0 errors.
2. Manual smoke via n8n Editor: "Execute Workflow" with pinned mock payload → verify 200 response shape.
3. Backend E2E (per phase-04 manual test plan) — `POST /api/agent-instances/:id/run` → poll `GET /api/executions/:id` until `status=success` with `output.outputJson.classifications`.
4. Failure path: create agent with `config.simulate_failure=true` → run → expect `status=failed` + Notification record.

## Done Criteria

- [ ] `wvyFRb1dM0QausJp` active, webhook `/webhook/gmail-lead-classifier` reachable
- [ ] `validate_workflow` returns no errors (runtime profile)
- [ ] Pinned-payload manual run produces §12.2 callback shape
- [ ] `simulate_failure=true` triggers failed callback with `MOCK_PROVIDER_TIMEOUT`
- [ ] Backup `gmail-real-organizer.json` exists with original 16-node content

## Out of Scope (deferred)

- Reintroducing real Gemini classification as optional branch
- Webhook header-auth for non-demo environments
- Per-environment workflow variants (dev vs prod)
- Workflows #2–#5 — covered by phase-08/09

## Open Questions

- Should the demo show real LangChain classifier output side-by-side with mock? (nice-to-have, not in current scope)
- Do we want execution audit log entries from n8n side, or rely solely on backend `AuditLog`? (current: backend-only)
