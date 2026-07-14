# Observed Full-App Browser Test — Report

**Date:** 2026-07-14 · **Branch:** `pivot/video-content-farm` (head `efdd6d4`) · **Driver:** headed agent-browser Chromium (CDP :9333) on `localhost:5173`
**Tenant:** seeded throwaway `74c195b1-3911-46c3-b310-c7d72ee7bee8` (leads Nghiep + Lam Tran; workspace Instruction "witty, punchy, SME founders SE Asia"; product memory "AI Automation Course"). **No connections** → every publish/email SEND path gates at `needs_connection`. **No real posts, no real emails were sent.**
**Env:** Docker Postgres :5433, backend :7100, web :5173 (Vite, IPv6 `[::1]`). All up.

## Scenario results

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| S1 | Multi-turn marketing + add/remove node | ⚠ PARTIAL | plan + add-node PASS; **remove-node broken (BUG-1)** |
| S2 | Edit & refine to regenerate | ✅/⚠ | conversational refine PASS; structured post-review unreachable (BUG-3) |
| S3 | Schedule + manual post inherits setup | ✅ PASS | strategist, 4-platform inherit, inline 12-slot calendar |
| S4 | Schedule birthday email | ✅ PASS | email-by-name, ✉ chain, localized confirm-ask; **flaky confirm (BUG-4)** |
| S5 | Lead collector | ✅ PASS | leads + scores + intake tokens |
| S6b | Document summarize | ✅ PASS | ran end-to-end, accurate |
| S7 | Analyze | ✅ PASS | real numbers, honest zero-handling |
| S8 | Memory | ✅ PASS | recall + panel + delete |
| S9 | Market research + send email | ⚠ | email framing PASS; **research node dropped (BUG-7)** |

S6 (nurturing email) not run separately — identical mechanism to S4 (`email_writer → scheduler → email_agent`).

## Bugs (prioritized)

### BUG-1 — HIGH · Remove-node refinement silently no-ops (false success)
**Repro:** create a marketing plan → "add a video step" (plan grows 5→7, Storyboard+Video added, deps rewired — works) → "remove the video and storyboard steps" → Atria replies *"I've adjusted the plan to remove the video and storyboard steps"* but the DAG is **unchanged (still 7 steps)**. Retried with "remove the Storyboard step" → same false-success. Reproduced twice.
**Impact:** user cannot subtract nodes; assistant asserts a change it didn't make (trust-breaking).
**Root cause (narrowed):** the subtraction logic `applyRemovals` (`src/orchestration/master/goal-merge.ts:111-142`) is **correct** — it maps `video`/`storyboard` to `needsVideo/needsStoryboard=false` (lines 122-123). The defect is **upstream**: on a remove turn the planner never re-ran (the reply was conversational and re-attached the *existing* plan artifact), whereas add turns re-planned. So the removal-intent delta isn't being extracted/routed. Investigate `requirement-analyzer.ts` removal-delta extraction and the brain's refine routing (`atria-brain.ts` / `master-agent.ts:56-59`) for the add/remove asymmetry.

### BUG-2 — MED · Plan-card controls hardcoded Vietnamese (ignores UI/convo language)
**Repro:** send an **English** campaign request → plan card renders English reply + node labels + refine box, but the action controls are Vietnamese: "▶ Duyệt & Chạy ngay", "Lưu thành flow", hint "Muốn chỉnh? Gõ bên dưới…", placeholder "Đặt tên flow để lưu". (In S4, the convo was VN so they *happened* to match — proving they're hardcoded, not localized.)
**Location:** `web/src/components/orchestrate-run-cards.tsx:92,100,105,109` (and `busy` labels "Đang lên lịch…/Đang chạy…"). Strategist CTA "▶ Draft the calendar" is already English — inconsistent.
**Fix:** localize these to the detected language (or English default) like the rest of the card.

### BUG-3 — MED · Connection gate fires *before* content generation; promised "draft to review" never appears
**Repro:** Approve & Run a single FB post on a connectionless tenant → `wf_run.status = needs_connection` with **both nodes (`concept_writer`, `publisher`) still `pending`** and **no `mkt_post` row** — no copy is ever generated. Atria's message promised *"review the draft once it's ready"*, but the run parks before writing anything. `resolveConnections()` (`src/connectors/runtime/connection-resolver.ts`) pre-gates the whole DAG.
**Impact:** the entire content-review / post-refine UX (playbook S11) is unreachable without a live platform connection; the message/behavior contradict. Consider running content-generation nodes and gating only at the publish node, so the user can review copy pre-connect.
**Related (OK):** the parked run surfaces on the landing as "CONTINUE WHERE YOU LEFT OFF → Untitled flow · Paused · needs a connection". But there is **no inline chat feedback** that the run parked.

### BUG-4 — MED (flaky) · Schedule-confirm turn intermittently errors
**Repro:** birthday email → localized confirm-ask shown → reply "Đúng rồi, xác nhận gửi lúc 1 giờ chiều mai" → *"Xin lỗi, mình đang gặp trục trặc khi xử lý yêu cầu này."* Retried "Xác nhận" → succeeded (*"Cảm ơn bạn đã xác nhận…"*). Not logged at error level in backend.
**Impact:** a safety-critical confirmation randomly fails. Likely a transient brain/LLM error or a parse trip on the longer restated-time message. Add error logging around the confirm path and a graceful retry.

### BUG-7 — MED · Compound "research THEN email/post" drops the research node
**Repro:** "Research the top 3 competitors… then send an email with the findings to Nghiep" → plan = **Email Writer → Email Agent** (2 steps, no researcher/content_search). Yet the reply promises *"My team will conduct the research and then draft an email summarizing the findings."* → reply/plan mismatch; email would be written from model knowledge, not grounded research.
**Root cause area:** backward-chaining node selection (`project_composable_planner`) didn't add a research producer for "findings". 

### BUG-5 — LOW · Summarize plan card mislabeled "📄 Single post / One post, set up end to end" (it's a summarize task, not a post).
### BUG-6 — LOW · Summarize `bullets` output rendered comma-joined ("…Indonesia.,Churn dropped…") instead of as list items.
### BUG-8 — LOW · Strategist calendar slot fields are narrow and truncate (titles + platform lists clipped, e.g. "facebook,inst…").
### MINOR · "add a video step" reply said "The current plan already incorporates a video step" (misleading — it was just added; plan did update correctly).
### MINOR · Command input not cleared after send on the landing view.
### FLAKY · A Send occasionally didn't submit (text stayed in the box); re-clicking Send worked (possible submit race).

## What worked well (validated fixes)
- **Email-by-name (P3):** "gửi email cho Nghiep" → ✉ Email chain (`email_writer → scheduler → email_agent`), recipient resolved from lead, **no @address asked**, no marketing/lead-collection framing.
- **Scheduler node + localized confirm-ask:** exact time "01:00 CH Thứ Tư, 15 tháng 7, 2026 (Asia/Bangkok)", "tomorrow 1pm" resolved correctly, "nothing scheduled until you confirm".
- **Single-vs-Strategist (P2):** cadence ("3 posts/week, monthly") → 🗓 Strategist; no cadence → 📄 Single post.
- **Platform inheritance:** FB+IG+Threads+X all inherited (not FB-only); distributed across the inline calendar slots.
- **Inline editable 12-slot calendar in chat (P2):** per-slot title/angle/asset-type/platforms/day-offset/remove; correct 3×/week × 4-week cadence; content pillars rotate; no navigation.
- **Instructions (P4):** copy came out "witty/punchy, SME-founder SE Asia" per the workspace Instruction.
- **Memory (P5a):** cross-language recall (EN seed → VN answer); 🧠 panel "What Atria remembers" (seeded + memory-every-turn learned facts: Product/Brand/Preference/Audience/Note); Forget deletes (5→4).
- **Analyze (data-query):** honest real numbers (0 posts, 2 leads, real spend) — no fabrication.
- **Summarize:** ran to completion (≈2 credits, 572 tok), accurate; "Publishing pauses… (safe / dry-run by default)".
- **Lead collector:** scored leads (Nghiep 72 / Lam 55), intake-token setup, encrypted note.
- **Constellation:** expands group → members (chip list); Memory reachable via Insight & Growth group.

## Suggested fix order
1. BUG-1 (remove-node false success) — trust + core refine flow.
2. BUG-2 (hardcoded VN) — quick, high visibility (`orchestrate-run-cards.tsx`).
3. BUG-3 (gate-before-content) — decide product behavior; blocks the whole review/refine UX for un-connected tenants.
4. BUG-4 (flaky confirm) — add logging + retry.
5. BUG-7 (research dropped) — planner selection.
6. BUG-5/6/8 + minors — cosmetic.

## Unresolved questions
- BUG-1: is it the requirement-analyzer LLM not emitting the removal delta, or the brain not routing remove turns through the planner? (Add a log of the parsed `removals` on refine turns to disambiguate.)
- BUG-3: intended product behavior — gate before or after content generation? Should un-connected tenants still see a reviewable draft?
- BUG-4: reproducibility rate of the confirm error (seen 1/2 here) — needs error-level logging to catch the actual exception.

## Artifacts
Screenshots per scenario in `plans/260714-0015-full-app-browser-test/results/` (s1–s9).

---

## Fixes applied (2026-07-14, same session)

**Bug fixes (tsc clean; golden 23/23; verify-summarize/executor/campaign-intent/agent-prompts green; live-verified):**
- **BUG-1 (remove-node) — FIXED.** Root cause: `atria-tools.ts` `propose_workflow` did additive `mergeGoals` only, never `applyRemovals`, and called `requirementAnalyzer.analyze` (which discards the removal delta). Now calls `analyzeWithRemovals` and applies `applyRemovals(merged, removals)` after the additive merge. Live: "add a video" → `concept writer|storyboard|video|publisher`; "remove the video and storyboard steps" → `concept writer|publisher`. ✅
- **BUG-2 (hardcoded VN) — FIXED.** `orchestrate-run-cards.tsx` VN strings → English (consistent with the rest of the card). Live: "▶ Approve & run now", "Save as flow", "Name the flow to save", "Want changes?…".
- **BUG-5 (summarize mislabeled "Single post") — FIXED.** Added 📝 Summary plan-scope (+ security-aware note).
- **BUG-6 (bullets comma-joined) — FIXED.** Added `case 'summary'` + `case 'security_scan'` in `flow/artifact-format.ts` (bullets render as a list). Live-verified in both the summary + scan artifacts.

**Feature: large-file Summarize + Security (Data Guard) node** — per user direction, GDPR/PII detection+masking is a SEPARATE composable node, not baked into summarize:
- New `security` registry node (Data Guard, group core, produces `security_scan`, 🛡️). `summarize.requires = ['security_scan']` → backward-chaining always runs security FIRST. `summarize` reads the MASKED text; falls back to raw source only if no scan ran.
- New `securityScanArtifact` schema `{hasSensitive, findings[{category,count,masked-example}], maskedText, notice}`. Categories: personal/contact/financial/government_id/health/credentials/other. Runner **fails CLOSED** (throws if sensitive found but masking empty — never passes raw source downstream). Example fields are pre-masked (no raw PII in artifacts).
- `sourceText` cap 20k → 200k for real documents. Brain `propose_task` description updated so it routes document/data-protection requests and announces the auto-masking.
- Files: `artifact-schemas.ts`, `goal-spec.ts`, `agent-types.ts`, `workflow-plan.ts`, `agent-registry.ts`, `workflow-planner.ts` (PIPELINE_ORDER), `agent-runners.ts` (runSecurity + runSummarize), `atria-tools.ts`, web `orchestrate-run-cards.tsx` / `artifact-format.ts` / `run-dag-view.tsx`. Verify: `verify-summarize-node.ts` rewritten (composition + masking + fail-closed + e2e) — all green.
- **Live-verified:** "Summarize this report… <Q3 memo with name/email/phone/diabetes/card>" → plan `🛡️ Data Guard → Summarize`; run masked [PERSONAL]/[CONTACT]/[HEALTH]/[FINANCIAL]; summary contained ZERO raw PII; Data Guard notice announced categories found.

**Not yet done (follow-ups):** BUG-3 (gate-before-content, product decision), BUG-4 (flaky confirm logging), BUG-7 (research-then-email drops research node), BUG-8 (calendar CSS truncation). Large-file: real file UPLOAD UI + PDF/docx text extraction (reuse product-knowledge multimodal path) + >40k chunking still to build — today the source is pasted text, security window is 40k chars.
