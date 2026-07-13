# P5 — Memory Makes Atria Smarter

**Priority:** MED · **Status:** P5a ✅ DONE (BE+FE, typecheck clean, deterministic verify green) · P5b DEFERRED (embeddings, post-demo) · **Layer:** backend (+ small FE for memory management UI).

## P5a done (2026-07-13)
- Brain memory-aware EVERY turn: `memoryContext` injected as a dynamic preamble part in `runAtriaBrain` (shared seam with P4) — fixes "Atria forgets mid-chat".
- `captureFromGoal` now persists product-keyed **angle** (`fact` kind `angle:<product>`). **Language intentionally NOT captured** — content language is derived per-turn (`contentLanguageFor`); a memory-driven language re-introduces the stale-`vi` wrong-language bug guarded in `atria-tools`. Documented in code.
- Reply-turn capture = the existing `save_memory` tool; brain prompt now explicitly nudges Atria to call it when the user shares a durable fact in ordinary conversation.
- Recall ranking: composite `score*10 + priority*4 + min(usedCount,10)*0.6 + recency*2` (14d window) — frequently-used + fresh facts win ties. `rankScore` in `user-memory.ts`.
- `GET/DELETE /memory/facts` (slot facts, distinct from learned style rules) + FE "What Atria remembers about you" list w/ delete in `memory-panel.tsx` (renamed old section → "Learned copy style").
- Verify: `verify-instructions-and-memory.ts` — angle captured, language-guard holds, usedCount ranks first, facts list/delete/404. Conversational recall across turns → P6 browser.

## Original plan below (P5a items now ✅; P5b = embeddings, deferred)

## Current state (two stores — don't conflate)
- **(A) UserMemory `mkt_memory`** (`schema.prisma:150-166`): slot facts (product/brand/audience/preference/contact/fact), keyword recall, dedup `@@unique([ownerId,kind,key])`, `usedCount` col. NO embeddings ("YAGNI", `schema.prisma:146`).
- **(B) Memory Agent** (`memory-agent.ts`): hand-edited posts → Gemini style rules → `Instruction(source='memory')` → grounds `concept_writer`. Opt-in via `POST /memory/accept` (`memory-router.ts:42-54`).

## Gaps (file:line) → fixes
| Gap | Evidence | Fix |
|---|---|---|
| Memory not injected into brain's conversational prompt → Atria "forgets" mid-chat | `atria-brain.ts:135-138` builds `contents` from history+message only; `memoryContext` sits unused on `ctx` (`:125`) | **P5a** prepend `memoryContext` as a dynamic preamble in `runAtriaBrain` (same seam as P4 instructions) |
| Capture only on proposal turns; drops language+angle | `orchestration-router.ts:285` (proposal) vs reply branch `:248-274` (no capture); `user-memory.ts:76-90` omits language/angle | **P5a** also capture on reply turns; add language+angle to `captureFromGoal` |
| `usedCount` incremented but never used in ranking (dead signal) | `user-memory-repo.ts:54-56` bumps; `user-memory.ts:55` sorts on score/priority only | **P5a** factor `usedCount` (+ recency) into recall ranking |
| No UI/endpoint to view/edit/delete slot memory | `forgetMemory` exists (`user-memory-repo.ts:59-60`) but unexposed; UI only for style rules (`memory-panel.tsx`) | **P5a** expose `GET/DELETE /memory/facts`; add a "What Atria remembers" list to the memory panel |
| Keyword-only recall — misses paraphrase | `user-memory.ts:18-25`; `schema.prisma:146` embeddings deferred | **P5b** add embeddings column + semantic recall (Gemini text-embedding), keyword as fallback |
| Style learning manual only | `memory-agent.ts:82-95` proposes, persists nothing until Accept | **P5b (optional)** auto-suggest surfaced more proactively; keep human Accept (safe) |
| No performance-based learning | `schema.prisma:96` "what performs" roadmap-only | **P5b (later)** feed post metrics into ranking/style — defer (YAGNI for demo) |

## Architecture
- **P5a (demo-worthy, low risk):**
  1. Inject `memoryContext` into brain `contents` dynamic preamble (`atria-brain.ts`) so EVERY turn is memory-aware, not just proposal turns. (Shares the P4 preamble seam.)
  2. `captureFromGoal`: add `language`, `angle`; call capture on the reply branch too (`orchestration-router.ts:248-274`) when the turn revealed durable facts (guard: only keyed slots).
  3. Recall ranking: `score*w1 + usedCount*w2 + recency*w3` in `user-memory.ts:52-56`.
  4. Expose slot memory: `GET /memory/facts`, `DELETE /memory/facts/:id` (`memory-router.ts` → `listMemories`/`forgetMemory`); FE "What Atria remembers about you" section in `memory-panel.tsx` with delete.
- **P5b (bigger, post-demo):** embeddings column on `mkt_memory` (migration) + embed-on-write + cosine recall (Gemini `text-embedding-004`), keyword as fallback for cheap/empty cases.

## Related code files
**Read:** `prisma/schema.prisma:140-166`, `src/memory/user-memory.ts:18-93`, `src/memory/user-memory-repo.ts` (upsert/list/forget/markUsed), `src/api/orchestration-router.ts:235,248-274,285`, `src/orchestration/atria/atria-brain.ts:125,135-138`, `src/orchestration/atria/memory-agent.ts`, `src/api/memory-router.ts:42-54`, `web/src/components/memory-panel.tsx`.
**Modify (P5a):** `atria-brain.ts` (memory preamble), `user-memory.ts` (capture language/angle; ranking uses usedCount+recency), `orchestration-router.ts` (capture on reply turns), `memory-router.ts` (+facts list/delete endpoints), `memory-panel.tsx` (slot-memory list + delete).
**Create (P5b):** embeddings migration + embed helper + semantic recall path.

## Implementation steps (P5a first)
1. Brain memory preamble (dynamic contents) — every turn memory-aware.
2. Capture language+angle; capture on reply turns (keyed only, deduped).
3. Ranking uses usedCount + recency.
4. `GET/DELETE /memory/facts` + FE memory list with delete.
5. Verify `verify-memory-recall.ts`: fact from turn A recalled in turn B (conversational, not just proposal); language captured; delete removes it.
(6. P5b: embeddings — separate later.)

## Todo (P5a)
- [ ] memoryContext preamble in brain contents
- [ ] capture language+angle + reply-turn capture
- [ ] ranking: usedCount + recency
- [ ] `GET/DELETE /memory/facts` + FE list/delete
- [ ] verify-memory-recall (conversational recall + delete)
- [ ] UI-flow verify (P6): tell Atria a fact in chat → new chat next → Atria recalls it without re-asking; see + delete it in the memory panel

## Success criteria
A fact stated in ordinary chat (not only a proposal) is remembered and grounds later turns (Atria doesn't re-ask); the user can SEE and DELETE what Atria remembers; recall favors frequently-used + recent facts. (P5b: paraphrased facts still recall via embeddings.)

## Risk
- Injecting memory every turn raises tokens → cap the block (top-8, 200 chars/line already) + dynamic-only (no cache pollution).
- Capturing on reply turns must stay keyed/deduped to avoid memory spam.
- Slot-memory delete must be tenant-scoped (owner check) — reuse `forgetMemory(ownerId,...)`.
