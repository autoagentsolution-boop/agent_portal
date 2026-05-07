# Phase 08: n8n Workflows #2 + #3 + Approval UI

**Day:** Day 9 (May 16, 2026)  
**Priority:** High  
**Status:** Implemented + E2E verified (2026-05-07)

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §14.2: Email Draft Responder
- Spec §14.3: Slack Daily Summary
- Spec §12: n8n workflow contract
- Prior handoff: `phase-07-execution-ui-polling.md` → Handoff Notes

## Overview
Create n8n workflows #2 (Email Draft Responder) and #3 (Slack Daily Summary). Add approval UI in execution output viewer for Email Draft Responder. Add backend approval endpoint. Spec rule: Email Draft must NOT send emails — output only, approval_status: waiting_for_review.

## Prerequisites
- Phase 07 complete: execution detail page with output viewer, `execution-output-viewer.tsx` checks templateId
- n8n running with workflow #1 already imported

## Files to Create / Modify

```
n8n-workflows/
├── email-draft-responder.json       (create)
└── slack-daily-summary.json         (create)

backend/src/modules/
└── executions/
    ├── executions.controller.ts     (add PATCH :id/approval)
    └── executions.service.ts        (add approveExecution, rejectExecution)

frontend/src/components/executions/
└── email-draft-approval.tsx         (create — Approve/Reject UI)
```

## n8n Workflow #2 — Email Draft Responder

### Workflow structure
```
Webhook Trigger (POST /webhook/email-draft-responder)
→ Extract payload (execution_id, config, callback)
→ Load mock emails (2-3 sample emails)
→ Generate draft replies (Code node — mock logic based on email subject)
→ Build output (spec §14.2 format):
  {
    items_processed: 2,
    drafts: [
      {
        original_subject: "Need automation help",
        subject: "Re: Need automation help",
        body: "Thank you for reaching out...",
        approval_status: "waiting_for_review"
      }
    ],
    summary: "2 drafts created and waiting for approval."
  }
→ Build callback payload (status: 'success', metrics)
→ HTTP Request → POST callback.url
  Headers: { x-demo-callback-secret: payload.callback.secret }
→ Respond to webhook
```

Key rule: `approval_status` is always `waiting_for_review` — n8n never sends emails.

### Callback metrics for Email Draft
```json
{
  "input_count": 2,
  "output_count": 2,
  "error_count": 0,
  "tokens_input": 800,
  "tokens_output": 400,
  "estimated_cost_usd": 0.005
}
```

## n8n Workflow #3 — Slack Daily Summary

### Workflow structure
```
Webhook Trigger (POST /webhook/slack-daily-summary)
→ Extract payload
→ Load mock Slack messages (10-20 mock messages)
→ Summarize (Code node — pick key themes from mock messages)
→ Build output (spec §14.3 format):
  {
    items_processed: 20,
    summary: "Team discussed API performance issues and client review deadline.",
    risks: ["API timeout may affect client delivery."],
    action_items: [
      { owner: "Engineering", task: "Fix API timeout", priority: "high" }
    ]
  }
→ HTTP Request → POST callback
→ Respond to webhook
```

## Backend: Approval Endpoint

### PATCH /api/executions/:id/approval
```typescript
// Request: { action: 'approve' | 'reject', note?: string }
// 1. Load execution
// 2. Verify template is email-draft-responder
// 3. Load ExecutionOutput
// 4. Update outputJson: set approval_status on all drafts to 'approved'/'rejected'
// 5. Write AuditLog: actor, action, executionId
// No email actually sent — demo rule
// Return updated execution output
```

Mark as `@Public()` with no auth for simplicity? No — keep auth guard. User must be logged in.

## Frontend: Approval UI

### execution-output-viewer.tsx (modify)
```typescript
// Add templateId check:
if (execution.templateId === 'email-draft-responder') {
  return <EmailDraftApprovalView output={output} executionId={execution.id} />;
}
```

### email-draft-approval.tsx
```typescript
// For each draft in output.drafts:
//   - Show original_subject (if present)
//   - Show draft subject (editable? No — demo: read-only)
//   - Show draft body in a styled box
//   - approval_status badge: waiting_for_review | approved | rejected
//   - If waiting_for_review: Approve + Reject buttons
//   - If approved/rejected: show status badge only (actions disabled)
//
// Approve button:
//   PATCH /api/executions/:id/approval { action: 'approve' }
//   → refetch execution → re-render with updated status
//
// Reject button:
//   PATCH /api/executions/:id/approval { action: 'reject' }
//   → refetch execution → re-render with rejected status
//
// Both buttons: disabled while request in flight
```

### Visual design
```
┌─────────────────────────────────────────┐
│ Draft Reply                             │
│ Subject: Re: Need automation help       │
│ ─────────────────────────────────────── │
│ Thank you for reaching out. We'd love   │
│ to schedule a demo to show you how...   │
│                                         │
│ Status: ● Waiting for Review            │
│                                         │
│ [✓ Approve]  [✗ Reject]                 │
└─────────────────────────────────────────┘
```

## Import Workflows into n8n
Both workflows must be imported and activated in n8n UI:
1. Open http://localhost:5678
2. New workflow → Import → paste JSON
3. Activate (toggle top-right)
4. Verify webhook URLs match n8nWebhookPath in seed data:
   - `/webhook/email-draft-responder`
   - `/webhook/slack-daily-summary`

## Done Criteria
- [x] Running Email Draft Responder → execution succeeds → output shows draft with Approve/Reject buttons
- [x] Clicking Approve → buttons disappear, status badge shows "Approved"
- [x] Running Slack Daily Summary → execution succeeds → output shows summary + action items
- [x] `PATCH /api/executions/:id/approval` with wrong execution → 404 or 400 (verified — 404 missing, 400 wrong template, 400 already-approved)
- [x] Email Draft output never shows "Email Sent" — only "waiting_for_review" → "approved"/"rejected"
- [x] Both workflows visible in n8n UI and active

## Implementation Notes (2026-05-07)

### Deviations from plan
- Approval endpoint accepts optional `draftIndex` for per-draft action (plan called for bulk only). Per-draft is the intended UX from the visual mockup, and adds zero complexity.
- Approval action is restricted to drafts currently in `waiting_for_review` — second approve on the same draft returns 400 (`Selected drafts are no longer in waiting_for_review`). Demo-grade race protection.
- Workflow `id` field added to JSON ("ap08EmailDraftRsp", "ap08SlackDailySum") — n8n CLI `import:workflow` requires it (UI import does not).

### Output payload shape (important for downstream phases)
n8n callback returns `result: { summary, data: {…} }`. Backend stores it as `outputJson = { summary, data: {…} }`. Both backend approval service and FE viewer therefore look at `outputJson.data.drafts` (with fallback to `outputJson.drafts` for any pre-spec data).

### Files added
```
n8n-workflows/
├── email-draft-responder.json
└── slack-daily-summary.json

backend/src/modules/executions/dto/
└── approval.dto.ts                      (Zod schema + status constants)

frontend/src/
├── hooks/use-approval.ts                (useDraftApproval mutation)
└── components/executions/email-draft-approval.tsx
```

### Files modified
- `backend/src/modules/executions/executions.service.ts` — `applyApproval()` w/ AuditLog write
- `backend/src/modules/executions/executions.controller.ts` — PATCH `:id/approval`
- `frontend/src/components/executions/execution-output-viewer.tsx` — templateId switch dispatches to EmailDraftApprovalView
- `frontend/src/pages/executions/execution-detail-page.tsx` — passes `executionId` into viewer

### Operational concerns
- **Auto-import**: n8n CLI `import:workflow` works only when the JSON has top-level `id`. Activation via `n8n update:workflow --id=… --active=true` requires container restart for webhooks to register. Persist this in any "fresh seed" script.
- **Network alias**: `docker network connect --alias n8n agentportal_default n8n-local-n8n-1` survives n8n container restart. Does NOT survive `docker compose down` of the n8n project — re-attach if you tear down n8n-local.
- **Audit log**: every approve/reject writes one row keyed by `entityType=execution, action=draft_approved|draft_rejected, afterJson={template_id, draft_indices, note}`. Phase 11 analytics can join on this.
- **Optimistic concurrency**: backend rejects approve-on-non-pending at the application layer; FE button disables during mutation. No DB row lock — acceptable for demo since two reviewers approving the same draft is theoretical.

### E2E verification (live)
- Email Draft Responder: agent `Drafter` (`cmouulhko000001w50iok51rl`) → exec `cmouulhvl000201w5vjzlji3q` → 2 drafts, draft 0 approved, draft 1 rejected via `PATCH /executions/:id/approval`. Final state confirmed: `["approved","rejected"]`.
- Slack Daily Summary: agent `DailyDigest` (`cmouupvah000201qc79f9rlhj`) → exec `cmouupvii000401qcydbuejc7` → summary "20 messages today. Top themes — customer, delivery, reliability.", 3 risks, 4 action_items.
- Negative paths: 404 on missing exec, 400 on wrong template, 400 on double-approve.

## Handoff Notes (for Phase 09)
- Approval endpoint: `PATCH /api/executions/:id/approval { action: 'approve'|'reject' }`
- Email Draft output format: `{ drafts: [{ subject, body, approval_status }], summary }`
- Slack Summary output format: `{ summary, risks[], action_items[] }`
- n8n workflow files in `n8n-workflows/` — must be manually imported to n8n
- `execution-output-viewer.tsx` now has templateId-based routing for custom renders
- Phase 09 adds two more workflows to n8n — same import pattern applies
