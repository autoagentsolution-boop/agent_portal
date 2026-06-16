# Phase 06 — Backward Compat + Cleanup + Docs

## Context Links
- v1 fixtures: `render-service/fixtures/cooking-pho-bo.json`, `render-service/fixtures/dishes/pho-bo.json`, `dishes/bun-cha.json`
- v1 entry script: `scripts/run-cooking-explode.ts`
- v2 entry script: `scripts/run-storyboard-v2.ts` (phase 05)
- Runbook to update: `docs/runbook-cooking-pipeline.md`
- Phase 01 `isV2()` helper

## Overview
- **Priority**: P2 (verification + handoff)
- **Status**: pending
- **Effort**: 2h
- **Brief**: Confirm v1 fixtures still render via existing path. Add optional schema-router so a unified CLI can dispatch to v1 or v2 by inspecting `schemaVersion`. Update runbook with v2 usage. Update `.env.example` if any new env vars introduced.

## Key Insights
- Backward compat already structurally guaranteed by phase 03 discriminated-union approach: v1 props (`steps`) and v2 props (`panels`) are mutually exclusive. v1 code path is never modified.
- The only file that v1 + v2 both touch is `CookingExplosion.tsx` — phase 03's diff is a single top-of-component branch. Verification = baseline diff (phase 03 step 7).
- Optional unified CLI is a nice-to-have: `scripts/run-cooking.ts` that reads `schemaVersion` and routes to v1 or v2 script. KISS preference: skip the unified CLI for v2.0, document both commands in runbook. Add it later if operator finds two-script UX painful.
- `.env.example` audit: phase 02 uses existing `GEMINI_API_KEY` (or `NANO_BANANA_API_KEY`), phase 04 uses existing `GEMINI_API_KEY`, phase 05 adds optional `COST_CAP_USD`. Add `COST_CAP_USD` line with comment.

## Requirements

### Functional
1. v1 fixture `render-service/fixtures/dishes/pho-bo.json` re-renders successfully via `scripts/run-cooking-explode.ts` after all phases 01-05 merged.
2. v1 output visually matches pre-phase-03 baseline (visual inspection + file size ±5%).
3. Runbook documents v2 command, cost expectations, ChatGPT prompt link, fixture location.
4. `.env.example` includes `COST_CAP_USD` with comment.
5. Schema-router helper documented (when/how `isV2()` is used).

### Non-functional
- No code changes that risk v1 regression.
- Documentation lives in `docs/` per `documentation-management.md` rules.

## Architecture

```
docs/runbook-cooking-pipeline.md
   │
   ├─ Existing v1 section (untouched)
   │
   └─ NEW v2 section:
       ├─ When to use v2 (ChatGPT-authored multi-panel storyboard)
       ├─ Workflow:
       │    1. Generate JSON via plans/260616-1319-storyboard-v2/prompts/chatgpt-storyboard-v2.md
       │    2. Save to render-service/fixtures/storyboard-v2/<dish>.json
       │    3. Run: npx tsx scripts/run-storyboard-v2.ts <fixture>
       ├─ Cost: ~$1.40/video fresh, $0 cached
       ├─ Flags: --dry-run, --skip-motion, --out=
       ├─ Troubleshooting:
       │    - validation errors → re-prompt ChatGPT with error message
       │    - Veo quota → wait 24h or use --skip-motion
       │    - props file too large → already handled via temp file
       └─ Comparison table: v1 vs v2 (cost, panel count, narration source, image style consistency)
```

## Related Code Files
- **Modify**: `docs/runbook-cooking-pipeline.md` (add v2 section)
- **Modify**: `.env.example` (add `COST_CAP_USD`)
- **Read**: `scripts/run-cooking-explode.ts` (confirm no edits needed)
- **Run-only**: v1 fixtures for regression test
- **Create**: none

## Implementation Steps

1. **v1 regression run**: from project root, `npx tsx scripts/run-cooking-explode.ts render-service/fixtures/dishes/pho-bo.json`. Compare output MP4 to baseline saved in phase 03 step 7. Acceptable: visual identity + byte size within 5%.
2. **Second v1 regression**: `bun-cha.json` for breadth. Same comparison.
3. **Schema-router doc**: in runbook, document the `isV2()` helper from phase 01 and note that future unified-CLI work would use it. KISS — no code added now.
4. **Runbook update**: open `docs/runbook-cooking-pipeline.md`, add v2 section per architecture diagram above. Cross-link to prompt file and plan dir.
5. **`.env.example`**: add line:
   ```
   # Optional cap on per-run estimated Veo cost (USD). If preflight exceeds, run aborts.
   # COST_CAP_USD=2.00
   ```
6. **Cleanup audit**:
   - Verify no `console.log` left in new files (use `logger`).
   - Verify no commented-out code.
   - Verify `git status` is clean of temp props files (add `render-service/temp/` to `.gitignore` if not already).
7. **Final acceptance**: run the v2 Bò Kho fixture one more time end-to-end with cache primed — confirm $0 spend, MP4 reproduces.

## Todo List
- [ ] v1 pho-bo regression render → matches baseline
- [ ] v1 bun-cha regression render → looks normal
- [ ] Add v2 section to `docs/runbook-cooking-pipeline.md`
- [ ] Add `COST_CAP_USD` to `.env.example`
- [ ] Add `render-service/temp/` to `.gitignore` if missing
- [ ] Strip stray `console.log` from phase-01..05 files
- [ ] Final cached v2 run = $0
- [ ] All `npx tsc --noEmit` clean across render-service

## Success Criteria
- v1 fixtures (pho-bo, bun-cha) render identically (visual + size sanity) post-v2-merge.
- Runbook has v2 section with command, cost, troubleshooting, link to prompt.
- `.env.example` lists `COST_CAP_USD`.
- `git status` clean (no temp files, no console.log noise).
- Cached v2 re-run = $0 confirmed.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| v1 regression discovered post-merge | Low | High | Phase 03 saved baseline; revert phase 03 commit if needed (other phases don't touch v1 code) |
| Operator forgets to generate ChatGPT JSON before running v2 script | Medium | Low | Script exits 1 with clear "file not found" message |
| Runbook diverges from actual command flags as code evolves | Medium | Low | Add note at top of v2 section: "Source of truth: run script with no args for usage help" |

## Security Considerations
- No new secrets introduced.
- `.env.example` comments only — never contains real values.
- `render-service/temp/` gitignore prevents accidental fixture JSON commits (which may contain costly-to-regenerate ChatGPT output but no secrets).

## Next Steps (post-plan)
- v2.1 candidate features (do NOT implement now, just note):
  - Per-panel `voiceRole` for multi-voice narration
  - `zoom`/`swipe` transitions properly implemented (currently fall back to `fade`)
  - Auto-stretch scene duration to match TTS audio length
  - Unified `scripts/run-cooking.ts` router using `isV2()`
  - Cache pruning util (`npm run cache:prune --older-than=30d`)
- Migration path for future v3: replicate the `schemaVersion` discriminator pattern. No v2 code needs deletion when v3 arrives.
