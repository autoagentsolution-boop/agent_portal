# Audit — context, memory, cache & token economics

**Date:** 2026-07-21 · **Branch:** `pivot/video-content-farm` @ `17870da` · **Scope:** the dimension
`docs/product/01-09` did not cover — memory layer, retrieval, caching, and where token spend actually goes.

**Headline:** the cost-optimisation thesis this audit set out to test is **wrong at current scale**, and
the measurement retracted the auditor's own leading hypothesis. Details below.

---

## 1. Sub-agent direction — docs 07/08 re-verified, no drift

`git log` shows **no `src/` commit since 2026-07-18**, when docs 07/08 were written. Every code claim in
them still holds. Nothing in this audit changes their conclusions:

- C7 (a node choosing the next node): 0 of 18 nodes benefit → never build
- Self-repair wrapper: measured trigger not met (0 malformed-output failures / 358 executions) → don't build
- Only `content_search` + `concept_writer` genuinely need tools, behind an explicit trigger
- The 5 action nodes + `security` stay deterministic functions permanently

**Decision this session: hold that line.** No new evidence to revisit it.

---

## 2. Measured token economics (dev DB, 30d window: 2026-07-06 → 07-18)

Total LLM+media spend in window: **$21.63**.

| surface | calls | prompt tok | thought tok | cached tok | USD | share |
|---|---|---|---|---|---|---|
| `infographic` | 232 | 2,017 | 0 | 0 | **9.27** | 43% |
| `video` | 17 | 0 | 0 | 0 | **6.42** | 30% |
| `orchestration` | 86 | 61,896 | 71,943 | 0 | 3.20 | 15% |
| `chat` | 727 | 1,680,170 | 181,281 | **1,108,400** | 0.81 | 4% |
| `intake` | 361 | 329,224 | 161,341 | 943 | 0.71 | 3% |
| `copygen` | 380 | 46,405 | 50,736 | 0 | 0.26 | 1% |
| (11 others) | — | — | — | — | <0.40 | 2% |

### 2.1 73% of spend is media generation, which no context strategy can touch

`infographic` ($0.040/image × 232) + `video` ($0.378/video × 17) = **$15.69 of $21.63**. Both are
priced per-asset, not per-token — `infographic` carries 2,017 prompt tokens *total* across 232 calls.

**Consequence:** caching, RAG, graph memory, and prompt trimming compete for the remaining 27%.
Any cost work should start at media unit economics (fewer regenerations, cheaper tiers, reuse), not context.

### 2.2 The explicit chat cache is working — 66% hit rate

`chat`: 1,108,400 cached of 1,680,170 prompt tokens. `atria-brain-cache.ts` (static system prompt +
tool declarations, TTL 1h, content-hash invalidated, fail-open) is doing its job. 727 calls for $0.81.
**No action needed.** This is the pattern to copy if caching is ever extended.

### 2.3 Orchestration cost is thought-token driven, not context driven

71,943 thought tokens vs 61,896 prompt vs 26,454 output. Thought tokens bill at the **output** rate.
Average orchestration run = **1,439 prompt tokens across 2.0 LLM calls** (max 3,288).

**Consequence:** the lever on orchestration cost is `thinking-budget.ts` (already exists, already
per-node, already scaled by `qualityPref`), not context size. There is no context bloat to remove.

### 2.4 RETRACTED — the product-knowledge blob is not a cost problem

**Hypothesis (from static reading):** `product-knowledge-router.ts:188` accepts `productDetails` up to
20,000 chars (~5k tokens); `product-knowledge-repo.ts:69` concatenates on every upload with no cap on
the merged result; `goalContext` (`agent-runners.ts:405-407`) injects it whole and uncapped into every
LLM node prompt. Estimated 4–6 re-sends per run of a ~5k-token static blob.

**Measured:** 1 row, **1,569 chars (~392 tokens)**, max = avg. Against ~2.0 LLM calls per run, the blob
contributes ~800 prompt tokens per run — a fraction of a cent.

**The 20,000-char ceiling is theoretical headroom nobody has approached.** Capping and caching it would
optimise a cost that does not exist. **Do not build it.**

*Bound:* dev DB, 1 product-knowledge row. This bounds observed reality, not production. The
concatenating-append path remains an unbounded-growth risk **in principle** — re-measure before
dismissing it permanently at real tenant volume. It is not actionable today.

### 2.5 Cache floor rules out caching node prompts — measured

Built every prompt via `buildAgentPrompt` and counted:

| agent | est. tokens |
|---|---|
| `campaign_strategist` | 612 |
| `storyboard` | 532 |
| `strategy` | 463 |
| `ideation` | 443 |
| `storyboard_carousel` | 336 |

Gemini explicit caching has a **~1024-token minimum**. Every node system prompt is below it.
`atria-brain-cache.ts` clears the floor only because the brain prefix carries tool declarations (~1.4k).
**"Cache the node prompts" is not implementable**, independent of whether it would be worth it.

---

## 3. Memory layer

**Measured:** `mkt_memory` = 43 rows / 12 tenants, avg 61 chars, max 219.

Recall (`memory/user-memory.ts`) is keyword token-overlap, top-8, 200-char cap ≈ **~400 tokens/turn**.
`listMemories` takes 200 rows. Neither cap is remotely near binding.

**Memory is cheap, not expensive.** Embeddings would not save money here.

### 3.1 The real defect is correctness, and the code documents it itself

`user-memory.ts:52-54`: keyword-only + monolingual means a Vietnamese query never matches an
English-stored fact. Mitigated by a `priority` flag that force-surfaces `product`/`brand`/`preference`
kinds **at relevance score 0** (`:55`, `:70`).

That hack is load-bearing: without it, core identity facts drop out entirely on any cross-language or
paraphrased query. With it, those facts surface on *every* turn regardless of relevance. Both branches
are wrong; the current one is wrong in the safer direction.

**This is the genuine case for embeddings — framed as recall correctness, not cost.** Not selected for
work this session.

### 3.2 A memory graph is not indicated

6 kinds, keyed upsert, ≤200 rows/tenant, no multi-hop relationship query anywhere in the product.
Graph RAG answers "connect A to C via B"; no marketing flow asks that. Same verdict as doc 08's
Option E — a framework for a problem that does not exist. **Recommend against.**

---

## 4. Security

**Clean — `atria-brain-cache.ts` shared singleton.** Module-level `handle` is shared across all
tenants, but the cached payload is *only* `atriaBrainSystemPrompt` + `TOOL_DECLARATIONS` + model name
(`:24-30`, `:37-42`). Zero tenant data. Safe by construction.

> **Risk if edited later:** adding any per-tenant content to that cache creates a silent cross-tenant
> leak with no test to catch it. Worth a verify script pinning "the cache payload is tenant-independent."

**Open — no cross-tenant isolation test.** Memory reads are `ownerId`-scoped at the query
(`user-memory-repo.ts:51`, and every mutation likewise). Doc 08 named tenant isolation its
highest-severity risk. There is still **no verify script that seeds two tenants and asserts zero
cross-read** across memory + product knowledge + instructions + the shared cache. Cheap to close;
not selected this session.

---

## 5. Documentation — done this session

Before: 38 files / 7,760 lines in `docs/`, no index; 54 plan dirs / 23,826 lines.

- Archived 7 superseded point-in-time handoffs → `docs/archive/` (`next-session-state-*`, `next-session-p6-*`)
- Added `docs/README.md` — entry points by role, operational doc groups, plans-vs-docs distinction,
  and a mapping table for the rule-mandated names
- Added a scope note to `docs/product/README.md` explaining that docs 07 and 08 answer *different*
  questions (closes doc 08's own concern #4)

**Found:** `.claude/rules/documentation-management.md` mandates `docs/system-architecture.md` and
`docs/code-standards.md`. Neither exists. Architecture is covered by
`product/01-architecture-techstack-layers.md` under a different name (mapped in the new index rather
than duplicated). **Code standards is a genuine gap** — the content lives in
`.claude/rules/development-rules.md`. Left unresolved: fixing it means either creating the file or
amending the rules, and amending checked-in project rules is the user's call.

Also noted: `docs/development-roadmap.md` last had a substantive edit 2026-07-08 and is stale.

---

## Status

**Status:** DONE

**Summary:** Re-verified docs 07/08 against an unchanged `src/` and held the sub-agent line. Measured
the context/memory/cache dimension they didn't cover and found the cost thesis wrong at current scale:
73% of spend is per-asset media generation that no context strategy touches, chat caching already runs
at a 66% hit rate, orchestration cost is thinking-budget driven, and the product-knowledge blob this
audit flagged as the main cache target measures 392 tokens — retracted. Node prompts (336–612 tokens)
sit below Gemini's ~1024-token cache floor, so caching them is not implementable regardless. Memory is
~400 tokens/turn and cheap; its real defect is cross-language recall correctness, not cost. Graph
memory recommended against. Documentation consolidated.

**Concerns:**

1. **All numbers are from a dev DB, 12 days, 1 product-knowledge row, 12 tenants.** They bound observed
   reality and are sufficient to *stop* work that would have optimised a non-existent cost. They are
   **not** sufficient to conclude these costs will never matter. Re-measure at real tenant volume before
   treating §2.4 as permanently settled.
2. **The `priority`-at-score-0 hack in memory recall is quietly load-bearing.** Anyone "cleaning up" that
   ranking function will silently break cross-language recall. It deserves a comment upgrade or a test.
3. **The tenant-isolation verify script remains unwritten** and is still the highest-severity open item
   carried over from doc 08. Not selected this session; it should not stay open indefinitely.

**Unresolved questions:**

1. `docs/code-standards.md` — create the file, or amend `.claude/rules/documentation-management.md` to
   point at `development-rules.md`? Needs a decision; rules are checked in.
2. Is `docs/development-roadmap.md` (stale since 2026-07-08) still wanted, or superseded by
   `FEATURES.md` + `docs/product/06`?
3. At what tenant/run volume should §2 be re-measured? Nothing currently triggers a re-check.
