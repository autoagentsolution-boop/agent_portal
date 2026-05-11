# Phase 03 — Tests + 5-Template Smoke + Demo Dry-Run

**Status:** pending | **Effort:** 0.5d | **Owner:** Mixed | **Depends on:** Phase 01, 02

## Context Links

- Brainstorm: `plans/reports/brainstormer-260511-0825-runtime-parameter-override.md`
- Phase 01 success criteria
- Phase 02 success criteria
- Existing demo doc: `DEMO_SCRIPT.md`
- Speed test pattern: `backend/src/scripts/speed-test.ts`

## Overview

Validate end-to-end across 5 templates, write minimal test coverage for the override pipeline, update DEMO_SCRIPT with iterative-tuning storyline.

## Requirements

### Functional
- Unit tests for `overrides-validator.ts` (whitelist, size cap, schema merge)
- Integration test: POST `/api/agents/:id/run` with overrides creates snapshot
- Integration test: retry copies overrides
- Smoke: each of 5 templates run successfully with overrides
- DEMO_SCRIPT updated with new storyline section

### Non-functional
- All existing tests still green (no regression)
- Smoke documented for replay on presenter machine

## Implementation steps

1. **Backend unit tests** — `backend/src/utils/overrides-validator.spec.ts`
   - Empty/missing overrides → returns `{ effective: base, snapshot: null }`
   - Override key not in whitelist → throws BadRequestException with `invalid_keys`
   - Override > 16KB → throws PayloadTooLargeException
   - Valid override → returns merged effective + snapshot
   - Override fails schema validation → throws BadRequestException with details

2. **Backend integration test** — extend `backend/test/agents.e2e-spec.ts` (or create if absent)
   - POST /run no body → 200, no snapshot
   - POST /run with valid override → 200, execution row has `configOverrideJson` + `effectiveConfigJson`
   - POST /run with invalid key → 400
   - POST /run with > 16KB → 413
   - POST /executions/:id/retry on prior overridden execution → new exec has same `configOverrideJson`

3. **5-template smoke script** — extend `backend/src/scripts/speed-test.ts` OR create `backend/src/scripts/override-smoke.ts`
   - Per template: run with overrides on 1 overridable field, verify execution finishes status=success, snapshot non-null
   - Output JSON summary to `speed-test-results/override-smoke-{ts}.json`
   - npm script: `npm run override-smoke`

4. **Frontend smoke (manual)**
   - Open each of 5 agents in browser
   - Modal renders correct fields per template
   - Submit with override, verify execution detail panel
   - Re-run flow works
   - Document any rendering quirks → fix or note

5. **Update DEMO_SCRIPT.md**
   Add new section "Iterative tuning" between existing E2E demo and analytics:
   ```markdown
   ## 5. Runtime parameter tuning (NEW)

   ### 5.1 First run (defaults)
   - Open agent "Sales Lead Pipeline"
   - Click Run → modal shows prompt, categories, max_items prefilled
   - Click Run with no changes → execution starts
   - Wait ~10s → execution status = success, N hot leads found

   ### 5.2 Tighten prompt
   - Click Run again → modal opens
   - Edit prompt: "Only mark hot if budget AND timeline mentioned"
   - Click Run → new execution starts
   - Wait → fewer hot leads vs first run

   ### 5.3 Inspect snapshot
   - Open second execution detail
   - "Configuration applied" panel shows: prompt | Default ... | Override ...
   - Note: "audit trail = which config produced which result"

   ### 5.4 Re-run from execution
   - Click "Run again with these overrides"
   - Modal prefilled with tightened prompt
   - Tweak max_items 50 → 100
   - Click Run → third execution
   - Compare 3 executions in agent history
   ```

6. **Cold-flow rehearsal** (optional but recommended)
   - `docker compose down && docker compose up --build`
   - Run smoke script
   - Walk through DEMO_SCRIPT step by step
   - Time the demo storyline (target < 3 min for section 5)

## Todo list

- [ ] Write `overrides-validator.spec.ts` (5 unit tests)
- [ ] Extend agents e2e tests (5 integration tests)
- [ ] Create `override-smoke.ts` + npm script
- [ ] Run override-smoke against 5 templates, fix issues
- [ ] FE manual smoke 5 templates
- [ ] Update DEMO_SCRIPT.md section 5
- [ ] Cold rehearsal walkthrough
- [ ] Time demo section ≤ 3 min

## Success criteria

- All new unit tests pass
- All new integration tests pass
- Existing test suite still green
- Override smoke: 5/5 templates success
- DEMO_SCRIPT section 5 demonstrable in ≤ 3 min on cold setup

## Risks

| Risk | Mitigation |
|---|---|
| 1-2 templates have schema fields that don't render cleanly in auto-form | Document in known issues; manually polish those 2 if time |
| n8n callback timing > demo patience | Speed test script already verified < 60s per run; reuse |
| Cold setup discovers env regression | Buffer to May 26 covers fix + re-rehearse |

## Next steps

After phase 03 complete:
- Update memory `project_agent_portal_demo.md` with phase 15 = override feature
- Commit `feat(phase-15): runtime parameter override (snapshot + auto-form modal)`
- Final commit + push to remote
- Record demo (deferred from prior phase)
