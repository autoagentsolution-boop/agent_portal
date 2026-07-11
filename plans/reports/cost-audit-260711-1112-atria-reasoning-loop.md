# Cost/Credit Audit — Atria Reasoning Brain (commit 0b7724a)

Date: 2026-07-11 · Branch: pivot/video-content-farm · Scope: LLM metering of the new tool-using brain loop per `POST /runs` turn.

## How metering works (baseline)
Every physical Gemini call must call `recordGeminiCall(raw, {ownerId, surface, model})` → `mkt_llm_usage` row (prompt+output+thought tokens, USD, credits ≈ tokens/250). Best-effort, never blocks. `extractGeminiUsage(raw)` normalizes the envelope; `recordLlmUsage({usage})` takes an already-extracted `GeminiUsage`.

## Per-turn call inventory

Entry path (`orchestration-router.ts` handleCreateRun): `recallForMessage` (DB, no LLM) → `getChatHistory` (DB) → `runAtriaBrain` → then reply→`recordAnswerTurn` (DB, **no author call**) OR proposal→`recordTurn`→`conversationAuthor.author`.

| Turn type | Physical Gemini call | Ledgered? | Surface | ownerId | Notes |
|---|---|---|---|---|---|
| **Greeting / simple reply** | brain round 0 `callGemini` (final answer, no tool) | ✅ | `chat` | `input.ownerId` ✓ | reply path = `recordAnswerTurn`, no author call. 1 call total. |
| **Reply + web_search** | brain round 0 (→web_search) | ✅ | `chat` | ✓ | |
| | `groundedSearch` (real Gemini + google_search) | ❌ **LEAK** | — (dropped) | — | dispatchTool destructures `{text, citations}`, **ignores `usage`**. |
| | brain round 1 (reads result → final answer) | ✅ | `chat` | ✓ | |
| **Data-query** | brain round 0 (→get_workspace_data) | ✅ | `chat` | ✓ | |
| | `answerDataQuery`→`authorAnswer` internal call | ✅ | `chat` | `ctx.ownerId` ✓ | self-ledgers (report-answer.ts:115). Redundant work (see cost note). |
| | brain round 1 (reads numbers → final answer) | ✅ | `chat` | ✓ | |
| **Proposal (create/run)** | brain round 0 (→propose_workflow) | ✅ | `chat` | ✓ | |
| | `requirementAnalyzer.analyze` | ✅ | `intake` | `ctx.ownerId` ✓ | self-ledgers (requirement-analyzer.ts:98). `planFromGoal` = deterministic, no LLM. |
| | *(loop short-circuits — no round 1 brain call)* | — | — | — | brain returns on `ctx.proposal` set. |
| | `conversationAuthor.author` (via recordTurn) | ✅ | `chat` | `req.userId` ✓ | conversation-author.ts:154. |
| recall_memory / save_memory tools | — | n/a | — | — | DB-only (user-memory.ts / user-memory-repo). Confirmed no LLM. |

## Leaks (severity-ranked)

### LEAK-1 (HIGH) — `web_search` / groundedSearch usage dropped
`atria-tools.ts:97` — `const { text, citations } = await groundedSearch(...)`. `groundedSearch` returns `{text, citations, usage}` (grounded-search.ts:91, real token usage via `extractGeminiUsage`), but dispatchTool **discards `usage`**. This is a REAL physical Gemini call (grounded generateContent) that writes **no ledger row** → its prompt+output+thought tokens are 100% invisible; the tenant is under-billed for every grounded search the brain performs. The brain is designed to search often ("get facts… so your next reply is grounded"), so this fires on a large share of reply turns.

Contrast: the researcher *node* handles this correctly — `run-research.ts:68` forwards `grounded.usage` via `onUsage` → ledgered as surface `research`. The brain path simply never wired the equivalent.

Grounded calls also incur Google's **search-grounding surcharge** (per-query $, beyond token cost). Even the researcher node only captures tokens, so that surcharge is a pre-existing gap — but LEAK-1 loses even the token cost, which is worse.

### No other leaks found
Brain-loop rounds, data-query author, intake analyzer, and proposal author all ledger to the correct tenant. recall/save memory are DB-only. `recordAnswerTurn` correctly makes no LLM call (the brain already produced the reply text).

## ownerId / surface labeling
- No system/null mislabeling found — every ledgered call threads the real `ownerId` (`input.ownerId` = `req.userId`).
- Minor surface-attribution note (not a leak): the brain's grounded search, once fixed, should record surface **`research`** (matches the researcher node) not `chat`, so per-surface billing analysis stays honest. The nested data-query author records `chat` (arguably should be `chat`; acceptable).

## Cost delta vs OLD path
OLD path = **2** physical calls/turn: 1 `intake` (analyze) + 1 `chat` (author).

NEW path per-turn physical calls:
| Turn | Calls | Multiplier | Ledgered / total |
|---|---|---|---|
| Simple reply | 1 (brain) | **0.5×** | 1/1 |
| Reply + 1 web_search | 3 (2 brain + 1 grounded) | **1.5×** | **2/3** ⚠ |
| Data-query | 3 (2 brain + 1 author) | **1.5×** | 3/3 |
| Proposal | 3 (1 brain + intake + author) | **1.5×** | 3/3 |
| **Worst case** (5 rounds: 2 searches + data-query + propose) | ~5 brain + 2 grounded + 1 dq-author + 1 intake + 1 author = **~10** | **~5×** | **8/10** ⚠ |

Token blow-up is worse than the call count suggests: each brain round **re-sends the entire growing `contents`** (up to 8 history turns + every prior functionCall + every tool response, incl. large web-search summaries) *plus* the full system prompt *plus* all `TOOL_DECLARATIONS` every round. So round-N prompt tokens grow ~linearly with N and tool-result size — a 5-round turn can cost far more than 5× a single old call in tokens. Credits ≈ tokens/250 scale accordingly.

Net: typical turns 1.5× the calls (and more in tokens due to fat brain prompts); worst case ~5× calls / potentially 10×+ tokens. Of those, the grounded-search calls are **entirely un-billed** until LEAK-1 is fixed.

## Fixes
1. **LEAK-1** (`atria-tools.ts` web_search case): capture and record usage.
   ```ts
   case 'web_search': {
     const { text, citations, usage } = await groundedSearch(str(args.query) || ctx.message);
     if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'research', model: env.GEMINI_MODEL, usage });
     ...
   }
   ```
   Requires importing `recordLlmUsage` from `../../cost/llm-usage.ts` and `env` from `../../config/env.ts` into atria-tools.ts. (groundedSearch returns extracted `usage`, so use `recordLlmUsage`, not `recordGeminiCall`.) Optionally add an `extraCostUsd` for the grounding-query surcharge.
2. **Cost-reduction (optional, not a leak):** slim per-round `contents` — cap/summarize tool responses before re-appending (web-search summaries are the biggest offender) to curb the quadratic prompt-token growth across rounds.
3. **Redundant data-query authoring (optional):** `get_workspace_data` runs `answerAnswer`'s Gemini author, then the brain authors its own final reply from the returned numbers — two chat-surface calls voicing the same data. Consider having the tool return raw metrics only (skip `authorAnswer`'s LLM call) and let the brain do the single voicing, saving 1 `chat` call per data-query turn.

## Unresolved questions
- Should the brain's grounded search bill surface `research` (consistent w/ researcher node) or `chat`? Recommend `research`.
- Google search-grounding per-query surcharge is uncaptured everywhere (brain AND researcher node) — is that in scope for a follow-up, or accepted as negligible at current volume?
- MAX_ROUNDS=5 with no per-turn token/credit ceiling: consider a hard token budget or round cap tied to spend, since a looping brain has no cost guardrail today.
