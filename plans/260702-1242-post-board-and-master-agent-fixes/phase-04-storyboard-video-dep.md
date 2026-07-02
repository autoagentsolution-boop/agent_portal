# Phase 04 — Storyboard/Video dependency (item 1)

**Priority:** MEDIUM (low risk, isolated)
**Status:** pending

## User decision (verbatim)
"storyboard có thể dùng để đăng không dùng để tạo video nhưng nếu có yêu cầu video thì chắc chắc phải có storyboard. Tức video phụ thuộc storyboard chứ storyboard không phụ thuộc video."

→ **video DEPENDS ON storyboard**. Storyboard can stand alone (for a post). Video always implies storyboard. Removing video keeps storyboard.

## Current (wrong) behavior
`workflow-planner.ts` selectAgents:
```ts
if (outputs.needsVideo) { ids.push('storyboard'); ids.push('video'); }
```
Storyboard exists ONLY as a child of video. No `needsStoryboard`. `deterministic-analyzer.ts:87` sets `needsVideo` on video/reel/clip/short/tiktok. Removal (`goal-merge.ts`) drops video via `disableOutputs`, but storyboard rides only under needsVideo so it vanishes too.

## Target behavior
- `needsStoryboard` independent flag.
- `needsVideo ⇒ needsStoryboard` (implication enforced in planner select, mirroring how `needsStrategy ⇒ ideation`).
- Analyzer: storyboard keywords (storyboard/kịch bản/phân cảnh/scene plan) set needsStoryboard; video keywords set needsVideo (which implies storyboard at plan time).
- Removal: "bỏ video" disables needsVideo only → storyboard stays. "bỏ storyboard" disables needsStoryboard AND needsVideo (can't have video without storyboard).

## Related code files
- MODIFY `MKTAgent/src/orchestration/schemas/goal-spec.ts` — add `needsStoryboard` to outputs
- MODIFY `MKTAgent/src/orchestration/master/workflow-planner.ts` — select storyboard on `needsStoryboard || needsVideo`; video on needsVideo
- MODIFY `MKTAgent/src/orchestration/master/deterministic-analyzer.ts` — storyboard keyword; RemovableOutput 'storyboard'
- MODIFY `MKTAgent/src/orchestration/master/goal-merge.ts` — mergeGoals OR needsStoryboard; applyRemovals: storyboard removal also clears video; video removal keeps storyboard
- CHECK LLM analyzer (requirement-analyzer / gemini) — does it emit needsStoryboard? Add to its schema/prompt or derive (needsVideo⇒needsStoryboard at merge)
- CHECK verify scripts referencing outputs flags

## Implementation steps
1. Add `needsStoryboard: boolean` to goal-spec outputs (default false). Migration? No — goal is JSON, no DB column. But existing stored goals lack the key → zod default handles it.
2. Planner: `if (outputs.needsStoryboard || outputs.needsVideo) ids.push('storyboard'); if (outputs.needsVideo) ids.push('video');`
3. Analyzer regex: `needsStoryboard: /\b(storyboard|kịch bản|phân cảnh)\b/iu.test(t)`. Add 'storyboard' to RemovableOutput + OUTPUT_TARGETS (with `\p{L}` safe wordRe).
4. goal-merge mergeGoals: `needsStoryboard: prior || delta || (needsVideo implied? keep explicit, planner implies)`. Keep merge simple — OR the flag; let planner own the video⇒storyboard implication.
5. applyRemovals: `if (disable.has('storyboard')) { needsStoryboard=false; needsVideo=false; }` `if (disable.has('video')) needsVideo=false;` (storyboard untouched).
6. Ensure LLM analyzer path can't emit needsVideo without the planner adding storyboard — planner implication covers it regardless of analyzer.
7. tsc + relevant verify.

## Todo
- [ ] goal-spec needsStoryboard
- [ ] planner select logic
- [ ] analyzer keyword + removal target
- [ ] goal-merge merge + removal coupling
- [ ] LLM analyzer schema check
- [ ] verify master/planner scripts green
- [ ] tsc
- [ ] Unit-ish check: "make a video" ⇒ storyboard+video; "storyboard only" ⇒ storyboard, no video; "bỏ video" on a video goal ⇒ storyboard remains

## Success criteria
- Video request always plans storyboard before video.
- Storyboard-only request plans storyboard, no video node.
- Removing video preserves storyboard; removing storyboard removes both.

## Risks
- Stored goals from before this change lack needsStoryboard — zod default `false` + planner video-implication means old video flows still get storyboard. Safe.
- LLM analyzer may not know the new flag; planner implication is the backstop so behavior is correct even if the analyzer never sets it.
