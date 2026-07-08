# Atria WOW Audit — Fix Plan (execute 2026-07-09)

Source: audit-summary.md (this dir) + `plans/reports/qa-260708-0346-*.md`.
All findings re-verified against live code before planning. **Reframed severity below.**

## Reframe after code verification
The raw audit called 4 things "P0". Verification splits them:
- **2 are clear bugs** with unambiguous fixes → phase-01, phase-02. Do these.
- **2 are deliberate design points** the code intentionally chose → phase-03, phase-04.
  They are DECISIONS, not defects. Don't "fix" until the product call is made.

## DECISION GATE — RESOLVED 2026-07-08 (user)
1. **Campaign scope** (phase-03): DO NOT auto-widen. Keep single-post default; drive escalation
   through Atria's PROACTIVE suggestions (signal → suggest → user approves → auto-plan). The
   suggest→approve→auto-plan loop already existed (accept prefills "Plan a month of content for X"
   which escalates). Added the user's named signal: **leads spiking on one product → suggest a
   campaign for it** (R1b). "Post with many views" deferred (no analytics data yet — "initially dummy").
2. **Autonomy kickoff** (phase-04): **Auto-run but DRY.** Wired a granted-run executor cron
   (`ENABLE_AUTONOMY_CRON`) that claims `approvalMode='atria' + planned` runs and executes them via
   the SAME gated executor; publishing forced DRY-RUN (no real external post).
3. **Auto-publish default** (phase-05 P1): **Default OFF + explicit toggle + Atria/NL control.**
   Goal-level `autoPublish` flag (analyzer detects "đăng luôn"/"auto-publish"), executor default OFF,
   /execute body toggle overrides per-run. Visible UI toggle deferred to the UI phase (seam ready).
4. **Cron flags**: user confirmed all ON in the running deployment.

## Phases — ALL CODE DONE 2026-07-08 (tsc backend+web green; pure verify green)
- [x] **phase-01** — Link-status persistence · migration SQL staged (apply on Docker up)
- [x] **phase-02** — Impact↔Usage credit reconcile · split mediaPieces(count) vs credit-basis(tokenless)
- [x] **phase-03** — Campaign-scope: proactive lead-spike suggestion (R1b) + verified pure
- [x] **phase-04** — Autonomy kickoff cron (DRY) · new ENABLE_AUTONOMY_CRON + claim-guarded
- [x] **phase-05** — implStatus stub→live ×3; auto-publish default OFF+NL+toggle seam; materialize partial-fail surfacing; P2-5 neutral seeds; P2-6 usage-missing warn

## Outstanding (need Docker up)
- Apply migration `20260708120000_post_link_status` (`prisma migrate deploy`).
- Run full verify suite (DB-backed) — pure checks already green.
- Rebuild web+api containers (no bind-mount) so UI changes take effect.
- P2-7 (skip-video stale snapshot) deferred — low impact; executor already re-reads fresh at gate.

## What's already solid (do NOT re-touch)
Real LLM+rule hybrid, live multi-post strategist, real publish gate, fail-closed autonomy
seam (HMAC), accurate token accounting incl. thinking tokens, real runners for all 9 agents,
Command Center shows real data (= Atria's intended final form), reapers real, no double-publish,
stale-attachedPost auto-publish already fixed. Evidence in audit-summary.md.
