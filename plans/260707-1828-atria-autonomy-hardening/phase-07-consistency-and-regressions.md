# Phase 07 — Consistency Cleanups + My Batch-3 Regressions  [H6, M1, M2, M3, M6, LOW]

**Priority:** HIGH (H6) → MED/LOW. **Status:** DONE 2026-07-08 (tsc backend+web + credits/llm-usage/executor/planner/refine/leads-post-deleted/leads-liveness-union green; migration applied). NOT committed.
**Implemented:** (H6+LOW) new `web/src/lib/credits.ts` mirroring backend anchors; run-dag-view badge basis → `cost>0?creditsFromUsd(cost):creditsFromTokens(totalTok)` (costUsd already sums token+media → fixes storyboard >10× undercount + model-tier-accurate; kills hardcoded 250/0.000625). (M1) shared `DEFAULT_LANGUAGE='vi'` in resolve-config, used by resolveCopyConfig AND resolveRunLanguage no-post branch (was 'en' → media/copy diverged). (M2) checkPostLinks iterates UNION of postUrls+commentSourceIds keys → URL-less X source existence-checked + self-heals; added injectable `aliveFn` DI seam. (M3) `Post.lastLivenessCheckAt` (migration 20260708001800) + sweep filters null-or-older-than `LEADS_LIVENESS_THROTTLE_HOURS`(6) + stamps after check → kills ~2× per-tick API. (M6) deleted dead `SPENDING_AGENTS` (0 imports, wrongly omitted live content_search); concept_writer gate already truthful via P01 gate:'selection'.
**Verify proves:** new verify-leads-liveness-union (X-only source self-heals to post_deleted, was un-healable). **Depends on:** none.
**Findings:** C#1, C#2, C#3, C#4, C#5, D#5. Report: `review-260707-1518-consistency-audit.md`, `review-260707-1828-workflow-registry.md`.

## Items

### H6 — [MY BUG] DAG node credit badge undercounts storyboard >10×
`web/src/components/run-dag-view.tsx` NodeStats — the mutually-exclusive ternary
`credits = totalTok>0 ? round(totalTok/250) : cost>0 ? round(cost/0.000625) : 0`
takes the TOKEN branch for a storyboard node (which has plan tokens) and silently DROPS the flat frame USD that is already summed into `node.costUsd`. Badge shows ~24 cr where Usage shows ~320 cr. Only fires on the flat-image fallback (no `usageMetadata`).
**Fix:** the node's `costUsd` is the TRUE total spend (token cost + media flat, already summed by `costFields`/`sumCost`). Derive the badge from it: `credits = costUsd>0 ? creditsFromUsd(costUsd) : creditsFromTokens(totalTok)`. This is one consistent basis (total-spend→credits), eliminates the undercount, and approximately matches the Usage page's additive per-surface credits (equal for flash-priced work; the two can't be made byte-identical without per-node token-vs-media USD split, which isn't available client-side — document this).
**Also fixes LOW/C#5:** stop hardcoding `250`/`0.000625`.

### LOW / C#5 — credit anchors duplicated in frontend
Create `web/src/lib/credits.ts` mirroring backend `src/cost/credits.ts` (`TOKENS_PER_CREDIT=250`, `USD_PER_CREDIT=0.000625`, `creditsFromTokens`, `creditsFromUsd`) with a comment pointing to the backend source of truth. Import in run-dag-view (and UsageDashboard if it recomputes). Keeps one place to change if the anchor moves.

### M1 / C#4 — language fallback diverges vi vs en
`src/copygen/resolve-config.ts` + the brief form fall back to `'vi'`; `resolveRunLanguage` (media/ideation/strategy/research) at `agent-runners.ts:309,511` falls back to `'en'`. A legacy run with NO attached post generates MEDIA in English while COPY assumes Vietnamese.
**Fix:** one shared final fallback. Make `resolveRunLanguage`'s no-post branch use the SAME chain/default as `resolveCopyConfig` (user.defaultLanguage, then a single literal default). Pick ONE literal default (recommend the user default, and only if that's null a single constant — align both to it).

### M2 / C#2 — [MY CODE] liveness sweep misses URL-less watched sources
`src/leads/sources/post-liveness.ts:27` `checkPostLinks` iterates `postUrls` only. A watched platform in `commentSourceIds` with NO `postUrls` entry (e.g. X) is never existence-checked, so `noneLeft` can't trigger and the collector never self-heals to `post_deleted` → polls until 30d expiry.
**Fix:** iterate the UNION of `postUrls` keys and `commentSourceIds` keys; for a source without a URL, resolve the id from `platformPostIds ?? commentSourceIds` and check liveness with a synthesized/empty url. Ensure `noneLeft` considers all watched sources.

### M3 / C#3 — [MY CODE] per-tick liveness sweep is expensive + redundant
`src/leads/sources/comment-cron.ts` runs a full `checkPlatformAlive` sweep across all watched posts every 30 min ON TOP of comment polling (~2× API volume), redundant with the poller's own `PostGoneError` detection, and re-checks already-dead URLs.
**Fix:** throttle — add `Post.lastLivenessCheckAt` (migration) and only sweep a post whose last check is older than N hours (e.g. 6h), OR run the sweep on a slower separate cadence (e.g. every 6h) instead of every leads tick. Skip platforms already dropped. Keep the reactive `PostGoneError` path as the fast detector.

### M6 / D#5 — stale/dead SPENDING_AGENTS + concept gate display mismatch
`src/orchestration/executor/node-cost.ts:113` `SPENDING_AGENTS` omits `content_search` (which is LIVE and bills LLM + $0.035 grounding — the comment wrongly calls it a "$0 stub") and the set has ZERO imports (dead code).
**Fix:** either delete `SPENDING_AGENTS` (dead) or correct it to include `content_search` and wire it where a spend guard is actually needed. Separately, `concept_writer.requiresApproval=false` is served to the UI/roster while the run parks `needs_approval` by default — make the registry value reflect actual behavior (it IS a selection gate), so Phase 01's registry-driven gates read truth.

## Related code files
Modify: `web/src/components/run-dag-view.tsx`, `src/copygen/resolve-config.ts` + `src/orchestration/executor/agent-runners.ts` (resolveRunLanguage), `src/leads/sources/post-liveness.ts`, `src/leads/sources/comment-cron.ts`, `src/orchestration/executor/node-cost.ts`, registry (concept_writer flag). Create: `web/src/lib/credits.ts`, `prisma` migration for `lastLivenessCheckAt`.

## Implementation steps
1. web/src/lib/credits.ts + rewire run-dag-view badge (H6 + LOW). tsc web.
2. Unify language fallback (M1); re-run copygen + language-touching verifies.
3. checkPostLinks union iteration (M2); re-run `verify-leads-post-deleted.ts`.
4. Liveness throttle (M3) + migration; re-run leads verifies.
5. SPENDING_AGENTS + concept_writer flag (M6); re-run `verify-executor.ts`, `verify-planner.ts`.

## Success criteria
- Node badge credits match the Usage page within rounding for every node type (no >10× gap).
- Copy + media of the same run always resolve the same language.
- A deleted X post self-heals to `post_deleted`; liveness sweep no longer doubles API volume every tick.
- No dead/incorrect spend map; concept gate metadata matches behavior.

## Verify
tsc backend+web; `verify-llm-usage`, `verify-credits`, `verify-executor`, `verify-leads-post-deleted`, `verify-leads-comments`, `verify-refine-and-overrides`. All green before closing.
