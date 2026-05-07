# Phase 09: n8n Workflows #4 + #5 + Real Integration

**Day:** Day 10 (May 19, 2026)  
**Priority:** High — Milestone M6 (All 5 Templates Live)  
**Status:** Done (2026-05-07). Workflows imported, activated via n8n UI, E2E verified on live stack. Real Slack live verification deferred (no bot token).

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §14.4: Google Sheet Data Checker
- Spec §14.5: Ticket Triage Agent
- Spec §7 (DEMO_2WEEK_PLAN): Real integration via n8n built-in nodes (no custom OAuth)
- Prior handoff: `phase-08-n8n-workflows-2-3-approval-ui.md` → Handoff Notes

## Overview
Create n8n workflows #4 (Google Sheet Data Checker) and #5 (Ticket Triage Agent). Add 1 real integration using n8n's built-in Slack node — no custom OAuth required. After this phase, all 5 templates are active and the full template catalog is demo-ready.

## Prerequisites
- Phase 08 complete: workflows #2 and #3 imported and active in n8n
- n8n running with built-in Slack node available (community edition includes it)
- For real Slack integration: Slack API Bot Token (set as n8n credential, not in app code)

## Files to Create

```
n8n-workflows/
├── google-sheet-data-checker.json    (create)
├── ticket-triage-agent.json          (create)
└── slack-daily-summary-real.json     (create — real Slack variant of workflow #3)
```

No backend changes needed — all 5 templates already seeded with correct `n8nWebhookPath`.  
No frontend changes needed — execution output viewer handles generic JSON display.

## n8n Workflow #4 — Google Sheet Data Checker

### Workflow structure
```
Webhook Trigger (POST /webhook/google-sheet-data-checker)
→ Extract payload
→ Load mock sheet data (Code node — 100 sample rows with some invalid)
  Mock rows: id, name, email, age, status
  7 rows have issues: missing email, invalid age, empty name
→ Validate each row (Code node — check required fields, email format, age range)
→ Build output (spec §14.4 format):
  {
    rows_checked: 100,
    invalid_rows: 7,
    issues: [
      { row: 12, field: "email", issue: "missing email" },
      { row: 23, field: "age", issue: "age out of range: 150" }
    ],
    summary: "100 rows checked. 7 invalid rows found."
  }
→ Build metrics (input_count: 100, output_count: 93, error_count: 7)
→ HTTP Request → POST callback
→ Respond
```

## n8n Workflow #5 — Ticket Triage Agent

### Workflow structure
```
Webhook Trigger (POST /webhook/ticket-triage-agent)
→ Extract payload
→ Load mock tickets (Code node — 5 sample support tickets)
  Mock tickets: subject, description, customer_tier
→ Classify each ticket (Code node — keyword-based priority/sentiment/category):
  Priority: "urgent"/"billing" keywords → high; "question" → low
  Sentiment: negative words → negative; else neutral
  Category: "billing_issue", "technical_support", "feature_request", "general_inquiry"
  Team: high priority → support_l2; else support_l1
→ Build output (spec §14.5 format):
  {
    items_processed: 5,
    tickets: [
      {
        ticket_id: "TCK-001",
        priority: "high",
        sentiment: "negative",
        category: "billing_issue",
        assigned_team: "support_l2"
      }
    ],
    summary: "5 tickets triaged. 1 high-priority ticket found."
  }
→ Metrics (input_count: 5, output_count: 5, error_count: 0)
→ HTTP Request → POST callback
→ Respond
```

## Real Integration — Slack via n8n Built-in Node

### Strategy
Use the Slack Daily Summary workflow but replace mock data with real Slack API call using n8n's built-in Slack node. No custom OAuth code required — n8n handles token management.

### slack-daily-summary-real.json workflow structure
```
Webhook Trigger (POST /webhook/slack-daily-summary)
→ Extract payload (read config.slack_channel from payload)
→ Slack node (built-in): "Get Messages" from config.slack_channel
  Credential: Slack Bot Token (set in n8n credentials UI)
→ If Slack call fails → use mock data fallback (Code node)
→ Summarize messages (Code node — extract key themes)
→ Build output (same format as spec §14.3)
→ HTTP Request → POST callback
→ Respond
```

### Setup steps for real Slack (documented for operator)
1. Create Slack app at api.slack.com → Bot Token Scopes: `channels:history`, `channels:read`
2. In n8n: Settings → Credentials → New → Slack → paste Bot Token
3. Import `slack-daily-summary-real.json`
4. In workflow: configure Slack node to use the credential
5. Set `slack_channel` in agent config to a real channel ID (e.g., `C01234ABCDE`)
6. Activate and test

### Fallback behavior
If no Slack token is configured, the workflow falls back to mock data automatically (Code node checks for empty Slack response). This ensures the demo works even without real credentials.

## Failure Simulation for Demo
Add a simulated failure path to Ticket Triage workflow (optional but useful for demo):
```
If config.simulate_failure === true:
  → Callback with status: 'failed', error: { code: 'MOCK_PROVIDER_TIMEOUT', retryable: true }
```
This lets the demo show the failure + notification + retry flow clearly.

## Import Checklist
After creating workflow JSONs, import into n8n:
- [ ] `google-sheet-data-checker.json` → activate → verify webhook URL
- [ ] `ticket-triage-agent.json` → activate → verify webhook URL
- [ ] `slack-daily-summary-real.json` → configure Slack credential → activate

All 5 webhook paths must match seed data in DB:
| Template | n8nWebhookPath |
|----------|----------------|
| gmail-lead-classifier | /webhook/gmail-lead-classifier |
| email-draft-responder | /webhook/email-draft-responder |
| slack-daily-summary | /webhook/slack-daily-summary |
| google-sheet-data-checker | /webhook/google-sheet-data-checker |
| ticket-triage-agent | /webhook/ticket-triage-agent |

## Done Criteria
- [x] Workflow JSONs authored for #4 (Google Sheet Data Checker), #5 (Ticket Triage Agent), and Slack real variant
- [x] Offline smoke test confirms Sheet output: 100 checked, 7 invalid (default config)
- [x] Offline smoke test confirms Triage output: 5 triaged, 1 high-priority (default config)
- [x] Offline smoke test confirms `simulate_failure: true` on Triage produces `MOCK_PROVIDER_TIMEOUT` failure callback
- [x] All 5 templates appear in wizard Step 1 (seeded; FE check deferred to Phase 12 polish)
- [x] Live: imported `google-sheet-data-checker.json` (id `ap09GSheetCheck`) and `ticket-triage-agent.json` (id `ap09TicketTriage`) into n8n; activated via UI
- [x] Live: Sheeter `cmotwv6g20006qcums54wqn3c` → exec `cmouvn27p000i01qc1y0ew9jl` → success, `100 rows checked. 7 invalid rows found.`, inputCount=100, outputCount=93, errorCount=7
- [x] Live: Triager `cmouvnyaw000l01qc7kpfja76` → exec `cmouvo3d2000n01qctqx7m8hs` → success, `5 tickets triaged. 1 high-priority ticket found.`, all 5 tickets categorized + assigned_team set
- [x] Live: TriagerFail `cmouvoel4000q01qcf2pc7kcs` (config.simulate_failure=true) → exec `cmouvolk4000s01qch38rh7mg` → status `failed`, errorMessage `Simulated provider timeout for demo`, **Notification row created with severity=critical, title="Execution failed: TriagerFail"** — Phase 10 dependency satisfied
- [ ] Live: real Slack integration — DEFERRED (no bot token configured; fallback path verified offline)

## Implementation Notes (2026-05-07)

### Files added
```
n8n-workflows/
├── google-sheet-data-checker.json
├── ticket-triage-agent.json
└── slack-daily-summary-real.json
```

No backend or frontend changes required — generic JSON viewer renders both new outputs.

### Deviations from plan
- **Sheet config key**: plan referenced "required_columns" — kept as comma-separated string to match seed.ts (`required_columns: 'name,email,phone'`). Validator splits on `,` and trims.
- **Triage TCK-004 wording**: original "Cannot login..." copy triggered both the `cannot login` HIGH keyword and the enterprise-tier escalation rule, producing 2 high-priority tickets. Reworded to a non-blocking latency complaint so default mock yields exactly **1 high-priority** ticket — matches spec §14.5 example summary.
- **Real Slack `integration_source` field**: added to callback body + result.data so demo can show whether the digest came from `slack_live`, `mock_fallback_empty`, `mock_fallback_after_error`, or `simulated_failure`. Backend currently ignores extra fields (Zod passthrough); useful if Phase 10 wants to surface "integration health" badge.
- **Real Slack credential placeholder**: workflow JSON ships with `credentials.slackApi.id = "REPLACE_ME_SLACK_CRED_ID"`. n8n UI import lets operator pick the real credential after import. CLI import will require sed/replace before activation.
- **Same webhook path on real variant**: `slack-daily-summary` is shared with the mock workflow. Operators MUST deactivate the mock before activating the real variant — n8n rejects duplicate webhook paths on activate.

### Output payload shapes (for downstream phases)

| Template | result.data shape |
|----------|-------------------|
| google-sheet-data-checker | `{ items_processed, sheet_id, rows_checked, invalid_rows, issues[{row,field,issue}], summary }` |
| ticket-triage-agent | `{ items_processed, tickets[{ticket_id,priority,sentiment,category,assigned_team}], summary }` |
| slack-daily-summary (real) | `{ items_processed, summary, risks[], action_items[], integration_source, slack_error }` |

`tickets[].assigned_team` honors `config.priority_threshold` — tickets with rank ≥ threshold route to `support_l2`, others to `support_l1`. Priority rank: low(1) < medium(2) < high(3) < critical(4).

### Offline validation (smoke test, no n8n)
Direct JS eval of the Code-node bodies via Node confirms:
- Google Sheet: 100 rows checked, 7 invalid, summary "100 rows checked. 7 invalid rows found.", issues at rows {12,23,34,45,67,78,89} matching planted defects.
- Ticket Triage default: 5 tickets, 1 high-priority (TCK-001), categories cover billing_issue + technical_support + feature_request + general_inquiry, sentiments cover negative + neutral + positive.
- Triage `simulate_failure: true` → status `failed`, error `{code:'MOCK_PROVIDER_TIMEOUT', retryable:true}`.

### Operational concerns
- **Webhook collision**: mock + real Slack workflows compete for `/webhook/slack-daily-summary`. Activate one. Document in import runbook.
- **Slack credential rotation**: bot token lives only in n8n credential store, never in workflow JSON or app code. Rotation is an n8n-UI operation; workflow doesn't need re-import.
- **Fallback observability**: `integration_source` in callback distinguishes real-Slack hits vs mock — analytics can filter out mock executions if needed in Phase 11.
- **Auto-import**: same `n8n import:workflow` pattern as Phase 08 — top-level `id` fields are present (`ap09GSheetCheck`, `ap09TicketTriage`, `ap09SlackDailyReal`).

## Handoff Notes (for Phase 10)
- Simulate failure: create Ticket Triage agent with `simulate_failure: true` in config → run → should fail with `MOCK_PROVIDER_TIMEOUT`. Same flag works on Sheet Checker and Real Slack variant too.
- Failure creates Notification record in DB (backend callback handler from Phase 04). Phase 10 surfaces these.
- All 5 templates fully active — no more n8n workflow work needed for the demo path.
- Real Slack is optional — fallback to mock keeps demo passing without a bot token.
- `n8n-workflows/` now contains 5 mock workflows + 1 real Slack variant. Operators import manually via UI (recommended) or CLI (must replace `REPLACE_ME_SLACK_CRED_ID` first).
- Extra `integration_source` field on Slack-real callbacks — Phase 10/11 may want to render an "integration mode" badge.
- Phase 10 focuses on surfacing notifications and integrations page — no n8n changes.
