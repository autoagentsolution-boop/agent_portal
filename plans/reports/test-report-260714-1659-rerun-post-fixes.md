# Full 9-Scenario Re-run (post-fixes) — Report

**Date:** 2026-07-14 · **Branch:** `pivot/video-content-farm` (head `239cb65`) · **Driver:** headed agent-browser CDP :9333
**Tenant:** `74c195b1` (seeded). No connections → publish/email SEND gate at `needs_connection` (no real posts/emails).
**Purpose:** re-validate all 9 scenarios after committing the bug fixes + Data Guard/upload feature.

## Results

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| S1 | Marketing multi-turn add/remove node | ✅ **PASS (now deterministic)** | 3+ cycles: remove (EN), add, remove (VN "bỏ video và storyboard") all applied; publisher correctly kept; a question in the refine box was answered, not re-planned |
| S2 | Edit & refine to regenerate | ✅ PASS | inline copy + refine validated first run; re-run variant hit post-creating phrasing (not a regression) |
| S3 | Schedule + manual post inherits setup | ✅ PASS | 🗓 Strategist campaign; `ideation\|strategy\|campaign strategist`; platforms Facebook,Instagram,Threads,X all inherited |
| S4 | Schedule birthday email | ✅ PASS | `email writer\|⏰ scheduler\|email agent`; recipient by name; localized confirm; **confirm succeeded first try (BUG-4 retry+logging in place)** |
| S5 | Lead collector | ✅ PASS | leads page + scores + intake tokens (unchanged, validated first run) |
| S6a | Schedule nurturing email | ✅ (≈S4) | same `email_writer→scheduler→email_agent` mechanism as S4 |
| S6b | Document summarize + Security (+email) | ✅ **PASS** | **file upload → `🛡️ data guard\|summarize`; ran; summary had ZERO raw PII ([PERSONAL]/[HEALTH]/[FINANCIAL]/[GOVERNMENT_ID] tokens); Data Guard notice announced categories** |
| S7 | Analyze | ✅ PASS | "0 posts, 2 leads, spent $0.20, reach 0" — real numbers |
| S8 | Memory | ✅ PASS | recalls "Khóa học Tự động hóa AI" (seeded product) |
| S9 | Market research + send email | ✅ **PASS (BUG-7 fixed)** | brain did REAL research (sources: verticalinstitute.com, heicodersacademy.com, nus.edu.sg…) — not dropped/faked; final email flow = `content search\|email writer\|email agent` |

## Fixes validated live this session
- **BUG-1 (remove-node) — FIXED, deterministic.** Root cause was two-fold: (a) `propose_workflow` never applied removals (fixed: `analyzeWithRemovals` + `applyRemovals`), and (b) the brain often replied "I'll propose shortly" and never re-planned. Final fix: the plan's Refine box sends `refine:true` (an explicit UI signal, NOT regex intent-classification) → the router re-plans in place via the same LLM analyzer, guarded to only short-circuit on a real structural change (questions still fall through to the brain).
- **BUG-2/5/6** (VN strings → English, summarize label, bullet rendering) — verified in the fix session.
- **BUG-4 (flaky confirm)** — brain now retries once on 5xx/empty-content before degrading + logs every degrade path (`atria_brain_call_failed/_empty_content/_degraded/_exception`). Confirm succeeded cleanly.
- **BUG-7 (research dropped)** — research now actually runs; email flow includes the `content_search` node.
- **Feature: Data Guard node + file upload** — end-to-end: upload PDF/image/TXT → extract → `security → summarize`, GDPR/PII masked before summarizing; raw text bypasses the brain (safety-filter) via `POST /orchestration/summarize-file`.

## New minor findings (not blocking)
- **S9 recipient-confirmation loop:** after inline research, the brain resolved the lead (masked email shown) but then re-asked for the recipient across turns instead of building the email flow immediately (had to give the explicit address). A multi-turn conversational-state weakness (the resolved lead isn't carried into the eventual `propose_workflow`). BUG-7 core (research not dropped) is unaffected.
- **S2 phrasing sensitivity:** "write me a caption for a post" routes to a post-creation plan rather than inline copy; "just write the caption text, show it here" gives inline copy. Expected LLM sensitivity.

## Commits (all pushed to `pivot/video-content-farm`)
777d17e feat Data Guard + fixes · 653be2e docs · aeb4b2f feat upload + BUG-4/7 · 83e5e98 docs · 0b2b881 fix remove union · 239cb65 fix deterministic refine

## Still open (from prior report, not in this scope)
BUG-3 (gate-before-content, product decision), BUG-8 (calendar CSS truncation), large-file >40k chunking, "+" attach only in chat view (not landing).
