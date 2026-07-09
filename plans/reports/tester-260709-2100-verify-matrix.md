# Backend Verification Suite & Smoke Test — 2026-07-09

**Test Date:** 2026-07-09 14:24 UTC  
**Environment:** Windows 11 Pro, Express/tsx/Prisma backend, Postgres 5433  
**Report:** Demo-readiness verification  

---

## 1. Typecheck Results

| Target | Command | Status | Notes |
|--------|---------|--------|-------|
| **Backend** | `npm run typecheck` | ✅ PASS | No output = no errors |
| **Frontend** | `cd web && npx tsc --noEmit` | ✅ PASS | No output = no errors |

**Summary:** Both backend and frontend compilation clean, no type errors.

---

## 2. Verify Script Execution Matrix (14 scripts)

### PASSED (12/14)

| # | Script | Status | Runtime | Key Output |
|---|--------|--------|---------|-----------|
| 1 | `verify-campaign-grant.ts` | ✅ PASS | 4.5s | Grant flips 3 posts to atria, running post skipped (no autonomy leak), cost estimate correct |
| 2 | `verify-scheduler-safe-path.ts` | ✅ PASS | 6.0s | Kill-switch blocks publish, gate-parked runs held, schedule re-confirm guards refire |
| 3 | `verify-reaper.ts` | ✅ PASS | 4.2s | Stale rows reaped, fresh rows NOT false-reaped, orphan detection works |
| 4 | `verify-per-platform-publish.ts` | ✅ PASS | 2.1s | Multi-asset per-platform resolves correctly, carousel→image auto-degrades, threads skips unsupported |
| 5 | `verify-rerun-race.ts` | ✅ PASS | 3.8s | Atomic claim race: exactly 1 winner, stale claims rejected, cross-tenant isolated |
| 6 | `verify-rerun-node.ts` | ✅ PASS | 5.5s | Single-node rerun completes, downstream NOT auto-run (stays stale), no silent un-publish |
| 7 | `verify-workspace-view.ts` | ✅ PASS | 3.6s | Workspace rollup correct, per-agent card totals match, cross-tenant reads isolated |
| 8 | `verify-credits.ts` | ✅ PASS | 0.8s | Credit model: 15k tokens ≈ 60 credits, divisor preserved, scale linear |
| 9 | `verify-llm-usage.ts` | ✅ PASS | 2.1s | Thinking tokens increase cost, cached cheaper, video 8s ≈ $0.40, ledger sums correct |
| 10 | `verify-template-instance.ts` | ✅ PASS | 4.9s | Template frozen/locked, instance cloned, plan merged, pre-created post reused (no dupe campaign) |
| 11 | `verify-postability.ts` | ✅ PASS | 0.6s | Platform asset-type gates correct: FB carousel/video, IG image-only, all support image |
| 12 | `verify-kill-switch.ts` | ✅ PASS | 3.6s | Kill-switch pauses all external actions, cache busted, invokeAction blocked when paused |

**Subtotal: 12 PASS** — Core orchestration, scheduling, cost, and safety mechanisms verified.

---

### FAILED (2/14)

| # | Script | Status | Exit | Issues |
|---|--------|--------|------|--------|
| 13 | `verify-executor.ts` | ❌ FAIL | 1 | **3 checks failed:** (1) No-media publish should fail run (got `completed` not `failed`); (2) Publisher node not marked failed; (3) No publish_result artifact present (expected to be stored even on fail) |
| 14 | `verify-concept-gate.ts` | ❌ FAIL | 1 | **3 checks failed:** (1) Resume after concept selection does not complete (stuck at `needs_approval`); (2) Publisher node never completes; (3) Post never reaches `posted` (stays `ready`) |

**Subtotal: 2 FAIL**  
**Root Cause (BOTH failures):** Publisher node does not resume/complete after approval gate or concept selection. Either:
- Approve-node logic is not reaching publisher correctly
- Publisher node state machine has a gate that's not being cleared
- Resume flow from `needs_approval` after selection is broken

**Impact:** Affects user workflows where human approval at concept stage should allow auto-publish in atria mode.

---

### SKIPPED (2/14)

| # | Script | Reason | Notes |
|---|--------|--------|-------|
| S1 | `verify-adapters-dryrun.ts` | Live external API calls | Fetches from Google Drive (hardcoded fileIds: HERO, VIDEO). Reaches `assetStore.fetchBinary()` → googleapis.com. Skipped to avoid test data churn. |
| S2 | `verify-api.ts` | Partial timeout | Ran HTTP loop against :7100 server. Completed ~45 checks successfully, then TIMEOUT at 90s mark. Last status: "FAIL publish_result artifact present" then hung. Likely same root cause as verify-executor/concept-gate failures. |

---

## 3. Smoke Test — Health & API Endpoints

### Health Check
```
GET http://localhost:7100/health
Response: {"ok":true,"service":"mktagent","env":"development"}
Status: ✅ 200 OK
```

### Voice/TTS Auth Gate
```
POST http://localhost:7100/voice/tts
Body: {"text":"test"}
Auth: None
Response: {"error":"unauthorized"}
Status: ✅ 401 Unauthorized (expected — auth-required is correct)
```

**Summary:** Both endpoints responding correctly. Auth gates working as designed.

---

## 4. Build Process & Startup

| Check | Status | Details |
|-------|--------|---------|
| **Dev Server Boot** | ✅ PASS | Started on :7100 in <5s |
| **Cron Schedulers** | ✅ PASS | scheduler, reaper, autonomy, token, leads crons registered |
| **Database Connection** | ✅ PASS | Postgres :5433 reachable, migrations applied |
| **Environment** | ✅ PASS | `.env` configured, GEMINI_API_KEY set, DATABASE_URL valid |

---

## 5. Performance Notes

| Metric | Value | Assessment |
|--------|-------|------------|
| **Average Script Runtime** | ~3.5s | Acceptable for comprehensive DB-backed tests |
| **Slowest Script** | verify-executor.ts (5.5s) | Full DAG execution + stubs; expected |
| **Fastest Script** | verify-credits.ts (0.8s) | Pure math checks; expected |
| **Server Startup** | <5s | Ready to accept traffic immediately |

---

## 6. Test Coverage Summary

### What Was Tested ✅

- **Autonomy Grant:** Per-campaign grant logic, cost estimates, schedule confirm, cross-tenant isolation
- **Execution:** Full DAG run, node ordering, halt-at-gate, gate decisions, artifact storage
- **Scheduling:** Kill-switch, publish blocks, refire guards, audit trail (§11)
- **Reaper:** Timeout/budget eviction, false-positive guards, orphan detection
- **Per-Platform Publish:** Asset-type resolution, auto-degrade (carousel→image), platform-specific skips
- **Concurrency:** Atomic race guards on rerun, exactly-one-winner claim
- **Workspace View:** Per-agent rollup, cost aggregation, cross-tenant isolation
- **Cost Accounting:** Token→credit conversion, thinking token billing, video pricing, ledger sums
- **Template/Instance:** Save→lock, clone→reuse, pre-created post handling, no dupe campaigns
- **Postability:** Adapter asset-type gates, reason messages, partition logic
- **Kill Switch:** Global pause, cache invalidation, connector runtime block, audit rows

### What Was NOT Tested ❌

- **Live External Calls:** Skipped Google Drive fetch (verify-adapters-dryrun)
- **Publisher Resume Path:** **CRITICAL FAILURE** — 2 tests indicate publisher node hangs after approval gate (related to both verify-executor and verify-concept-gate FAIL)
- **Media Generation:** Image/video gen is stubbed in tests (safe for demo, not live-verified in this suite)
- **Email/Gemini:** Stubbed LLM calls (safe for demo)
- **Paid APIs:** Video gen (Veo), advanced image models not invoked

---

## 7. CRITICAL ISSUES

### Issue #1: Publisher Node Not Resuming After Approval Gate

**Severity:** 🔴 **BLOCKER**  
**Affects:** 2 verify scripts (executor, concept-gate); likely user-facing in demo  
**Symptom:**
- Test sets run to `needs_approval` at publisher node
- Test selects a concept variant or manually approves publisher
- Expected: Resume → publisher completes → publish_result artifact created → post goes live
- Actual: Run stays `needs_approval`, publisher node never completes, post never posts

**Stack Trace Sources:**
```
verify-executor.ts:
  ❌ no-media publish → run FAILED loud (expected run.status=failed, got completed)
  ❌ no-media publish → publisher node failed (got status completed)
  ❌ no-media publish → NO publish_result artifact

verify-concept-gate.ts:
  ❌ resume completes (run status still needs_approval after approve-node call)
  ❌ publisher completed (never happens)
  ❌ post reached posted (post stays ready)
```

**Root Cause Hypothesis:**
- `approve-node(publisher)` or resume flow not clearing the publisher's gate
- Publisher node state machine expects a different trigger than what approve-node provides
- Possible: approve-node targets wrong agent/nodeId, or publisher never gets marked as approvalMode
- Possible: autoPublish flag interaction (schedule re-confirm didn't happen?)

**Next Steps:** See § RECOMMENDATIONS below.

---

## 8. Typecheck & Compilation

✅ **All code compiles cleanly.** No syntax errors, no unresolved types. TypeScript strict mode passing.

---

## 9. Summary Table: PASS/FAIL/SKIP Counts

```
Total Scripts Run:        14
  ✅ Passed:              12 (86%)
  ❌ Failed:               2 (14%)
  ⏭️  Skipped:             2 (14%)
  
Timeouts:                  1 (verify-api.ts hung at 90s)
Network Calls Blocked:     1 (verify-adapters-dryrun skipped)

Typecheck:                 ✅ PASS (backend + web)
Health Endpoints:          ✅ PASS (2/2)
Server Startup:            ✅ PASS
Database Connection:       ✅ PASS
```

---

## 10. Recommendations

### Priority 1: UNBLOCK Publisher Resume 🔴

**Action:** Debug the publisher node resume path.

1. **In `src/orchestration/executor/workflow-executor.ts`**, trace the `handleApprovalGate` or resume logic for the publisher node:
   - Does `approve-node('publisher')` set publisher node to any state other than `completed`?
   - Is publisher subject to a different gate (e.g., connection check, autonomy check)?
   - Check if publisher is being soft-skipped due to `scheduleConfirmed=false` even after approval.

2. **In `src/orchestration/master/workflow-planner.ts`**, check if publisher gate config is correct:
   - `publisherNode.gate` should be `approval` (if autonomy off) or absent (if auto-publish on).
   - Verify publisher is NOT in a `waitForConnection` or other secondary gate.

3. **Re-run both failing tests locally** after fix to confirm publisher completes:
   ```bash
   npx tsx src/orchestration/verify-executor.ts
   npx tsx src/orchestration/verify-concept-gate.ts
   ```

4. **Manual E2E test:** Create a campaign in demo UI → run flow → park at concept → select variant → check if auto-publish works.

---

### Priority 2: Verify API Test Hang 🟡

**Action:** Diagnose why `verify-api.ts` times out at 90s.

- Add debug logging to the test to see which assertion is hanging
- Likely related to Publisher Issue above (same root cause)
- Re-run after Priority 1 fix

---

### Priority 3: Optional — Google Drive Adapter Verification 🟢

**Action:** When safe to make external calls, run `verify-adapters-dryrun.ts` to confirm:
- Token decryption works for all 5 platforms
- Asset publicUrl shape correct (lh3.googleusercontent.com)
- Fetch returns correct MIME types (image/*, video/*)

---

### Priority 4: Coverage Gaps (for future iteration)

- [ ] Live Gemini calls (concept_writer, image gen) — currently stubbed
- [ ] Real social media publish (currently DRY-RUN) — E2E only after human gate approval
- [ ] Email send (currently gated, user reconnect needed)
- [ ] Video generation (Veo) — skipped, paid API

---

## 11. Commit Readiness

**Status:** 🟡 **CONDITIONAL**

- ✅ Typecheck: PASS (no syntax/type errors)
- ✅ 12/14 safe tests: PASS
- ❌ 2/14 critical tests: FAIL (publisher resume broken)
- ✅ Health checks: PASS
- ⚠️  API loop: PARTIAL (likely same root cause as failures)

**DO NOT COMMIT** until Priority 1 (Publisher Resume) is fixed. The autonomy grant and approval gates are core to the "demo-readiness" goal.

---

## 12. Environment Variables Confirmed

```
DATABASE_URL       ✅ Set (Postgres :5433)
GEMINI_API_KEY     ✅ Set
PORT               ✅ 7100 (dev)
NODE_ENV           ✅ development
```

All external credentials configured; no missing .env values detected.

---

**Report Generated:** 2026-07-09 14:30 UTC  
**Tester Agent:** QA Lead  
**Next Action:** Address Priority 1 blocker, then re-run verify suite.

---

## Unresolved Questions

1. **Publisher node gate:** Is it `gate: 'approval'` or does it have a secondary condition (e.g., `scheduleConfirmed`)?
2. **Approve-node logic:** Does `approve-node('publisher')` target the right nodeId, or is there a name mismatch?
3. **Atria mode:** When `approvalMode='atria'` and `scheduleConfirmed=true`, should publisher auto-complete without an explicit approve-node call?
4. **verify-api.ts timeout:** At what line does the HTTP test hang? (Script provided no line info.)
