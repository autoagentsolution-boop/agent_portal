# Phase 01 — Business Outcome Analytics

**Status:** in progress
**Priority:** high (demo gap)

## Context

User asked for business-outcome reporting per-agent. Operational analytics already exist (`/analytics/summary`, `/analytics/agents/:id`). Demo data has populated `outputJson` for 3 templates (gmail-lead-classifier, slack-daily-summary, ticket-triage-agent). Other templates (email-draft-responder, google-sheet-data-checker) wired by extractor with safe fallbacks.

## Architecture

```
GET /api/analytics/agents/:id/business-outcomes?range=7d|30d|all
   ↓
AnalyticsService.getAgentBusinessOutcomes()
   ↓ Prisma: Execution + ExecutionOutput where templateId, range
   ↓ For each exec: registry[templateId].extract(outputJson) → { metric: number }
   ↓ Sum + apply headline + compute hours_saved = (items × manualMinutesPerItem) / 60
   ↓
{ range, execution_count, headline_metric, metrics[], estimated_hours_saved, estimated_basis }
```

## Files

### New
- `backend/src/modules/analytics/business-outcomes/extractors/gmail-lead-classifier.ts`
- `backend/src/modules/analytics/business-outcomes/extractors/email-draft-responder.ts`
- `backend/src/modules/analytics/business-outcomes/extractors/slack-daily-summary.ts`
- `backend/src/modules/analytics/business-outcomes/extractors/google-sheet-data-checker.ts`
- `backend/src/modules/analytics/business-outcomes/extractors/ticket-triage-agent.ts`
- `backend/src/modules/analytics/business-outcomes/registry.ts`
- `backend/src/modules/analytics/business-outcomes/types.ts`
- `frontend/src/hooks/use-agent-business-outcomes.ts`
- `frontend/src/components/analytics/business-outcomes-panel.tsx`
- `frontend/src/components/analytics/range-selector.tsx`

### Modified
- `backend/src/modules/analytics/analytics.service.ts` — add `getAgentBusinessOutcomes()`
- `backend/src/modules/analytics/analytics.controller.ts` — endpoint
- `frontend/src/lib/types.ts` — add types
- `frontend/src/pages/agents/agent-detail-page.tsx` — new "Outcomes" tab

## Metric mapping (registry source-of-truth)

| Template | Headline | Other | Min/item | Basis text |
|---|---|---|---|---|
| gmail-lead-classifier | hot_leads | leads_classified, warm_leads, cold_leads, hot_lead_rate% | 2 | "2 min saved per lead classified manually" |
| email-draft-responder | drafts_approved | drafts_created, avg_word_count | 6 | "6 min saved per approved draft (vs writing from scratch)" |
| slack-daily-summary | risks_flagged | messages_summarized, action_items_created | 0.5 | "30s saved per message reviewed" |
| google-sheet-data-checker | invalid_rows | rows_checked, error_rate% | 0.3 | "20s saved per row validated" |
| ticket-triage-agent | critical_tickets | tickets_triaged, high_priority, sentiment_negative | 3 | "3 min saved per ticket triaged" |

## Todo

- [x] Read context (existing controllers, hooks, detail page)
- [x] Plan files
- [ ] BE: types + 5 extractors + registry
- [ ] BE: service method + controller endpoint
- [ ] BE: compile + curl smoke
- [ ] FE: types + hook
- [ ] FE: range selector + outcomes panel components
- [ ] FE: wire into agent detail page as new tab
- [ ] FE: tsc build check

## Success criteria

- `curl /api/analytics/agents/demo-agent-sales-leads/business-outcomes?range=7d` returns valid shape with non-zero metrics
- Range switcher 7d/30d/all changes returned counts
- Empty agent (no execs in range) returns `execution_count=0` + empty metrics, page renders empty state
- Hours saved shown with basis text below
- Existing tabs (Overview, Configuration, Executions, Notifications) unaffected

## Risk

- Extractor receiving unexpected schema — guard with `safeNumber` and `Array.isArray` checks; fail closed (return 0, not crash)
- `range=all` on heavy workspace — cap query to 1000 execs (good for demo, document for prod)
