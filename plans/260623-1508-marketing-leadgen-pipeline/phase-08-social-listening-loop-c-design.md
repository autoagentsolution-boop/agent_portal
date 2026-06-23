# Phase 08 — Social-Listening Loop C (DESIGN ONLY)

**Context:** [plan.md](plan.md) · reuses Loop-A advisory-lock + Sheet control-plane + Loop-B lead capture.
**Priority:** P3 (after Phase 1 posting loop runs with live creds). **Status:** design-only, not built.
**Origin:** user-flagged X post `x.com/sairahul1/status/2066871937167761641` (16 Jun 2026) — "AI agent does
marketing on autopilot: searches Reddit, replies, promotes product subtly, using Claude Sonnet."

## What we take vs reject

The tweet sells an **outbound auto-reply** agent. We split it:

| Component | Verdict | Why |
|-----------|---------|-----|
| Social **listening** (find relevant posts) | ✅ adopt | read-only, ToS-clean, real value (automates "where to market") |
| LLM **relevance scoring + reply draft** | ✅ adopt | Claude Sonnet drafts; cheap (~cents/batch) |
| **Auto-posting** the reply | ❌ reject | astroturfing; violates Reddit + most subreddit ToS → shadowban + brand damage |

Net: agent does the boring part (find + draft), **human keeps the publish button**. This is augmentation,
not autopilot — mirrors the Phase-2 review-gate philosophy.

## Architecture (Loop C — human-in-loop)

```
cron (e.g. hourly) → advisory-lock (reuse pattern) → exit if locked
  → Reddit API search (official OAuth API, read-only — NOT scraping)
       queries = product keyword set (from a Sheet `listen_config` tab)
  → Claude Sonnet: per candidate post → {relevanceScore 0-1, why, draftReply}
  → filter relevanceScore ≥ threshold
  → dedupe by post URL (skip already-seen)
  → append to Sheet `opportunities` tab (status=new)
  → release lock
        ↓ (human reviews, replies MANUALLY, sets status=engaged)
        ↓ if the human's reply CTA drives a form submit → flows into Loop B (existing lead capture)
```

Two independent loops already exist (A posting, B leads); this is a third that **feeds** B, replaces nothing.

## `opportunities` tab — columns (design)

| Col | Field | Notes |
|-----|-------|-------|
| `foundAt` | ISO | server time |
| `source` | `reddit` (X deferred — paid API) | platform |
| `postUrl` | string | dedupe key |
| `subreddit` | string | context |
| `postTitle` / `postExcerpt` | string | what the user asked |
| `relevanceScore` | 0-1 | Claude score; sort desc |
| `whyRelevant` | string | Claude one-line rationale |
| `draftReply` | string | Claude suggestion — human edits before posting |
| `product` | string | which product this maps to |
| `status` | enum `new → reviewing → engaged → skipped` | human-driven lifecycle |

## Cost / API reality

- **Reddit API:** official OAuth, free tier ~100 req/min — ample for periodic listening. **Read-only = ToS-OK.**
  The ToS violation is only in auto-*writing*; we keep writes human-side.
- **X listening:** deferred — needs paid Basic tier (~$100-200/mo, see P06 X flag). Reddit is the cheap entry.
- **Claude Sonnet:** batch-score posts, ~cents per run. Use `claude-sonnet-4-6`.
- No video / Slides — lightest loop of the three.

## Why design-only / not now

- Phase 1 posting loop must run with live Meta creds first (don't widen scope mid-build).
- Reddit listening has its own OAuth app + keyword tuning — a self-contained later effort.
- Highest-value-per-effort once inbound (Loop B) is proven, since Loop C just feeds more into B.

## Risks

| Risk | L×I | Mitigation |
|------|-----|------------|
| Temptation to auto-reply "to save time" | M×H | Hard design rule: Loop C never writes to Reddit. Publish is human-only. |
| Low-relevance noise floods `opportunities` | M×M | relevanceScore threshold + cap N/run; tune keyword set in `listen_config` |
| Reddit API token expiry | L×M | same refresh pattern as Meta tokens (P03) |
| Drafts sound robotic / off-brand | M×M | human edits before posting; collect good edits as few-shot examples (golden-prompt parallel) |

## Next Steps
Build only after Phase 1 live. Needs: Reddit OAuth app, `listen_config` + `opportunities` tabs, one Claude
node, reuse of the Loop-A lock + Sheet write-back nodes.
