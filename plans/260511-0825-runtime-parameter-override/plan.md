---
slug: runtime-parameter-override
created: 2026-05-11
completed: 2026-05-11
status: completed
branch: main
budget: 1-2 days
related_brainstorm: plans/reports/brainstormer-260511-0825-runtime-parameter-override.md
blockedBy: []
blocks: []
---

# Runtime Parameter Override — Implementation Plan

## Goal

Add per-execution runtime override of agent config (whitelist subset). KH bấm Run → modal hiện form auto-generated từ schema → tweak → BE merge với agent.configJson, validate, snapshot vào Execution row, đẩy n8n. Workflow JSON KHÔNG đổi.

## Source

- Brainstorm: `plans/reports/brainstormer-260511-0825-runtime-parameter-override.md`
- Demo deadline: 2026-05-26

## Phases

| # | Name | Status | Effort |
|---|------|--------|--------|
| [01](phase-01-backend-override-pipeline.md) | Backend override pipeline (schema + validator + service) | done | 0.5d |
| [02](phase-02-frontend-run-modal-and-rerun.md) | Frontend RunAgentModal + execution detail re-run | done | 1d |
| [03](phase-03-tests-and-demo-dryrun.md) | Tests + 6/6 unit pass + DEMO_SCRIPT updated | done | 0.5d |

## Pending operator actions (one-time)

- `cd backend && npx prisma migrate dev` once Postgres is up — applies `add_execution_config_snapshot` migration (3 nullable cols)
- `npm run prisma:seed` to populate `overridableFieldsJson` for 5 templates
- Manual smoke 5 templates in browser (one per template, verify modal renders + override applied panel)
- Cold-start rehearsal + record demo (see DEMO_SCRIPT Act 4b)

## Critical decisions (locked from brainstorm)

- Override scope = whitelist subset per template (`AgentTemplate.overridableFieldsJson`)
- Persistence = snapshot 2 cols on Execution: `configOverrideJson` (diff) + `effectiveConfigJson` (merged final)
- UI = auto-generate form from `template.configSchemaJson`
- Trigger UX = modal on Run button click
- Schedule mode = NOT supported (manual-only)
- Profiles = re-run from execution (no separate model)
- Backward compat = n8n payload `config` still receives final merged → workflow unchanged

## Out of scope

- OverrideProfile model + CRUD
- Schedule binding profiles
- Per-template custom UI
- Git-style diff
- Bit-identical replay
- Per-role override permission

## Architecture rule (preserved)

```
FE → BE /api/agents/:id/run { overrides? } → BE merge+validate+snapshot → n8n payload.config (merged) → callback → BE
```

FE NEVER calls n8n directly. n8n workflow contract unchanged.

## Success criteria

1. POST `/api/agents/:id/run` with valid overrides → snapshot created, n8n receives merged config
2. Invalid override key (not in whitelist) → 400 with key list
3. Invalid override type (vs schema) → 400 with field errors
4. Override JSON > 16KB → 413
5. 5/5 templates have working overridable whitelist + render correct form
6. "Run again with these overrides" prefills modal with `configOverrideJson` from old execution
7. Execution detail shows "Configuration applied" panel with diff
8. Schedule run unchanged (uses `agent.configJson`, ignores override path)

## Demo storyline

Update `DEMO_SCRIPT.md` adding "Iterative tuning" section:
1. Agent "Sales Lead Pipeline" → Run → modal prefilled defaults
2. Tweak prompt → Run → fewer hot leads
3. Execution detail → "Configuration applied" diff
4. "Run again with these overrides" → tweak max_items → Run
5. 3 executions in history with distinct outcomes
