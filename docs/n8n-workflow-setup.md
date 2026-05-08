# n8n Workflow Setup

The portal's backend dispatches every agent run to a self-hosted n8n workflow via webhook. The 7 workflows live as JSON in `n8n-workflows/`. This doc covers two paths to get them into n8n: **CLI import** (fast, scriptable — recommended) and **UI import** (operator-friendly, visual confirmation).

## Workflows

| File                                   | Webhook path                              | Approval | Used by template               |
|----------------------------------------|-------------------------------------------|----------|--------------------------------|
| `gmail-lead-classifier.json`           | `/webhook/gmail-lead-classifier`          | no       | gmail-lead-classifier          |
| `email-draft-responder.json`           | `/webhook/email-draft-responder`          | yes      | email-draft-responder          |
| `slack-daily-summary.json`             | `/webhook/slack-daily-summary`            | no       | slack-daily-summary            |
| `slack-daily-summary-real.json`        | `/webhook/slack-daily-summary-real`       | no       | (optional real Slack variant)  |
| `google-sheet-data-checker.json`       | `/webhook/google-sheet-data-checker`      | no       | google-sheet-data-checker      |
| `ticket-triage-agent.json`             | `/webhook/ticket-triage-agent`            | no       | ticket-triage-agent            |
| `gmail-real-organizer.json`            | `/webhook/gmail-real-organizer`           | no       | (optional Gmail integration)   |

## Path A: CLI import (recommended)

Runs entirely from the host shell. Idempotent — re-import overwrites existing workflows by name.

```bash
# 1. Copy the JSON exports into the n8n container
docker compose cp n8n-workflows n8n:/tmp/workflows

# 2. Import all (separate file mode — one workflow per JSON)
docker compose exec n8n n8n import:workflow --separate --input=/tmp/workflows

# 3. Restart n8n so imported workflows are visible to the runtime
docker compose restart n8n
```

Imported workflows are **deactivated by default**. Activate them in the UI (next step) or accept that the demo data won't update until you do.

> **Windows / Git Bash gotcha:** Bash rewrites `/tmp/workflows` to a Windows path before docker sees it. Prefix with `MSYS_NO_PATHCONV=1`:
>
> ```bash
> MSYS_NO_PATHCONV=1 docker compose exec n8n sh -c 'n8n import:workflow --separate --input=/tmp/workflows'
> ```

## Path B: UI import (visual)

Use this when demoing setup or onboarding a non-engineer.

1. Open http://localhost:5678 → log in (`admin` / `admin`).
2. For each file in `n8n-workflows/`:
   1. Click **Workflows** (left nav) → **Add workflow** → **⋮** → **Import from File**.
   2. Select the JSON file.
   3. Top-right **Active** toggle → **on**.
   4. Save.
3. Repeat for all 7 files.

## Activation (mandatory)

Workflows must be **Active** for the backend to trigger them. An inactive workflow returns `404 Not Found` from the webhook, surfaced in the portal as:

```
n8n trigger failed: n8n responded 404 Not Found
```

**Verification:** in n8n's Workflows list, every imported workflow should show a green **Active** badge.

## Quick smoke test

```bash
# 1. Hit a webhook directly (replace path as needed)
curl -X POST http://localhost:5678/webhook/gmail-lead-classifier \
  -H "Content-Type: application/json" \
  -d '{"execution_id":"test_local","callback":{"url":"http://backend:4000/api/n8n/callback","secret":"local-demo-secret"},"input":{"items":[]}}'

# Expected: 200 OK with { received: true } (or similar acknowledgement)
```

If this returns 404 → workflow not imported or not active.

If this returns 200 but no callback fires → check n8n execution log (Workflows → Executions tab) for the failed step.

## (Optional) Real Slack integration

The `slack-daily-summary-real.json` workflow uses a real Slack bot token instead of mock data. To enable:

1. Create a Slack app at https://api.slack.com/apps → enable bot scopes `channels:history`, `channels:read`.
2. Install to a workspace, copy the **Bot User OAuth Token** (`xoxb-…`).
3. In n8n: **Settings → Credentials → New → Slack API** → paste token → save.
4. Open `Slack Daily Summary (Real)` workflow → bind the credential to the Slack node → **Active** toggle.

The mock variant (`slack-daily-summary.json`) keeps working without any credential — that's the default for the demo.

## Workflow contracts (reference)

Every workflow follows the spec in `agent_operations_portal_local_demo_spec.md` §12:

**Inbound (webhook payload from backend):**
```json
{
  "execution_id": "cuid",
  "callback": { "url": "http://backend:4000/api/n8n/callback", "secret": "..." },
  "agent_instance_id": "...",
  "config": { /* template-specific */ },
  "input": { "items": [] }
}
```

**Outbound (callback POST to backend):**
```json
{
  "execution_id": "cuid",
  "status": "success | failed | warning",
  "metrics": { "duration_ms": 0, "input_count": 0, "output_count": 0, "error_count": 0,
                "tokens_input": 0, "tokens_output": 0, "estimated_cost_usd": 0 },
  "result": { /* template output schema */ },
  "error_message": "..." 
}
```

The shared secret in the callback header is `N8N_CALLBACK_SECRET` from `.env` — must match on both sides.

## Editing workflows

Two paths:

1. **In n8n UI:** edit, save. To preserve changes across rebuilds, export back to JSON: **⋮ → Download** → commit to `n8n-workflows/`.
2. **In the JSON file:** edit, then re-import (overwrites existing). Useful for AI-assisted bulk edits.

Keep workflow logic deterministic for demo runs — random outputs make the speed test results meaningless.
