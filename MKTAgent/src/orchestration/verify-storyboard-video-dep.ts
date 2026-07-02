// Item 1 — storyboard/video dependency. Video DEPENDS ON storyboard; storyboard is
// independent (usable alone). Deterministic, no DB. Covers: analyzer flags, planner
// selection, and the merge/removal coupling ("bỏ video" keeps storyboard; "bỏ storyboard"
// drops both).
import { analyzeDeterministic, parseRemovals } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { applyRemovals, mergeGoals } from './master/goal-merge.ts';
import { goalSpec } from './schemas/goal-spec.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const agentIds = (goal: ReturnType<typeof goalSpec.parse>): string[] => {
  const r = planWorkflow(goal);
  return r.ok ? r.plan.nodes.map((n) => n.agentId) : [];
};

// 1. Video request → storyboard implied.
const gVideo = analyzeDeterministic('Make a video for our product on facebook');
check('video msg sets needsVideo', gVideo.outputs.needsVideo, gVideo.outputs);
check('video msg implies needsStoryboard', gVideo.outputs.needsStoryboard, gVideo.outputs);
const vidIds = agentIds(gVideo);
check('plan: video has storyboard before it', vidIds.includes('storyboard') && vidIds.includes('video'), vidIds);

// 2. Storyboard-only request → storyboard, NO video.
const gSb = analyzeDeterministic('Create a storyboard for a facebook post about our product');
check('storyboard msg sets needsStoryboard', gSb.outputs.needsStoryboard, gSb.outputs);
check('storyboard-only does NOT set needsVideo', !gSb.outputs.needsVideo, gSb.outputs);
const sbIds = agentIds(gSb);
check('plan: storyboard present, video absent', sbIds.includes('storyboard') && !sbIds.includes('video'), sbIds);

// 3. Remove video from a video goal → storyboard REMAINS.
const removedVideo = applyRemovals(goalSpec.parse(gVideo), parseRemovals('bỏ video'));
check('bỏ video → needsVideo false', !removedVideo.outputs.needsVideo, removedVideo.outputs);
check('bỏ video → needsStoryboard STAYS true', removedVideo.outputs.needsStoryboard, removedVideo.outputs);
const rvIds = agentIds(removedVideo);
check('plan after bỏ video: storyboard kept, no video', rvIds.includes('storyboard') && !rvIds.includes('video'), rvIds);

// 4. Remove storyboard → BOTH gone.
const removedSb = applyRemovals(goalSpec.parse(gVideo), parseRemovals('bỏ storyboard'));
check('bỏ storyboard → needsStoryboard false', !removedSb.outputs.needsStoryboard, removedSb.outputs);
check('bỏ storyboard → needsVideo also false', !removedSb.outputs.needsVideo, removedSb.outputs);

// 5. Additive merge keeps storyboard flag.
const base = analyzeDeterministic('Write a facebook post about our product');
const merged = mergeGoals(base, gSb);
check('merge carries needsStoryboard', merged.outputs.needsStoryboard, merged.outputs);

// 6. "add storyboard" (EN) on a text goal → storyboard added, video NOT.
const gAddSb = analyzeDeterministic('add a storyboard');
check('add storyboard → needsStoryboard', gAddSb.outputs.needsStoryboard, gAddSb.outputs);
check('add storyboard → NOT needsVideo', !gAddSb.outputs.needsVideo, gAddSb.outputs);

console.log(failures === 0 ? '\nPASS — storyboard/video dependency green' : `\nFAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
