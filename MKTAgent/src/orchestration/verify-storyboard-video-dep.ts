// Storyboard/video INDEPENDENCE (inverted 2026-07-21 — this file previously pinned the opposite).
//
// Video used to require `storyboard`: a video goal planned 3-6 still frames, then fed each frame's
// STILL-composition prompt to Veo as if it were a motion prompt, and spoke the image captions aloud.
// Video now requires `video_script`, which plans motion, timing and narration as first-class fields.
//
// The assertions below therefore check ABSENCE as hard as presence: a video goal that still drags a
// storyboard along is not a cosmetic regression — it silently generates and BILLS 3-6 images that
// nothing downstream consumes. Deterministic, no DB, no network.
import { analyzeDeterministic, parseRemovals } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { applyRemovals, mergeGoals } from './master/goal-merge.ts';
import { goalSpec } from './schemas/goal-spec.ts';
import { getAgent } from './registry/agent-registry.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const agentIds = (goal: ReturnType<typeof goalSpec.parse>): string[] => {
  const r = planWorkflow(goal);
  return r.ok ? r.plan.nodes.map((n) => n.agentId) : [];
};

// 0. The registry edge itself — the root of everything below.
const video = getAgent('video');
check('registry: video requires video_script', !!video?.requires.includes('video_script'), video?.requires);
check('registry: video does NOT require storyboard', !video?.requires.includes('storyboard'), video?.requires);

// 1. Video request → video_script, and NO storyboard.
const gVideo = analyzeDeterministic('Make a video for our product on facebook');
check('video msg sets needsVideo', gVideo.outputs.needsVideo, gVideo.outputs);
check('video msg does NOT imply needsStoryboard', !gVideo.outputs.needsStoryboard, gVideo.outputs);
const vidIds = agentIds(gVideo);
check('plan: video_script before video', vidIds.indexOf('video_script') >= 0 && vidIds.indexOf('video_script') < vidIds.indexOf('video'), vidIds);
check('plan: NO storyboard in a video-only flow', !vidIds.includes('storyboard'), vidIds);

// 2. Storyboard-only request → storyboard, and NO video / video_script.
const gSb = analyzeDeterministic('Create a storyboard for a facebook post about our product');
check('storyboard msg sets needsStoryboard', gSb.outputs.needsStoryboard, gSb.outputs);
check('storyboard-only does NOT set needsVideo', !gSb.outputs.needsVideo, gSb.outputs);
const sbIds = agentIds(gSb);
check('plan: storyboard present, video absent', sbIds.includes('storyboard') && !sbIds.includes('video'), sbIds);
check('plan: no video_script without a video', !sbIds.includes('video_script'), sbIds);

// 3. Both requested → two independent branches, both present.
const gBoth = goalSpec.parse({ ...gVideo, outputs: { ...gVideo.outputs, needsStoryboard: true, needsVideo: true } });
const bothIds = agentIds(gBoth);
check('plan: both storyboard and video when both asked for', bothIds.includes('storyboard') && bothIds.includes('video'), bothIds);
check('plan: video_script present alongside storyboard', bothIds.includes('video_script'), bothIds);

// 4. Removing one no longer removes the other (the old coupling, gone in both directions).
const removedVideo = applyRemovals(goalSpec.parse(gBoth), parseRemovals('bỏ video'));
check('bỏ video → needsVideo false', !removedVideo.outputs.needsVideo, removedVideo.outputs);
check('bỏ video → needsStoryboard STAYS true', removedVideo.outputs.needsStoryboard, removedVideo.outputs);
const rvIds = agentIds(removedVideo);
check('plan after bỏ video: storyboard kept, no video/video_script', rvIds.includes('storyboard') && !rvIds.includes('video') && !rvIds.includes('video_script'), rvIds);

const removedSb = applyRemovals(goalSpec.parse(gBoth), parseRemovals('bỏ storyboard'));
check('bỏ storyboard → needsStoryboard false', !removedSb.outputs.needsStoryboard, removedSb.outputs);
check('bỏ storyboard → needsVideo SURVIVES (no longer coupled)', removedSb.outputs.needsVideo, removedSb.outputs);
const rsIds = agentIds(removedSb);
check('plan after bỏ storyboard: video still renderable', rsIds.includes('video_script') && rsIds.includes('video') && !rsIds.includes('storyboard'), rsIds);

// 5. Additive merge keeps the storyboard flag.
const base = analyzeDeterministic('Write a facebook post about our product');
check('merge carries needsStoryboard', mergeGoals(base, gSb).outputs.needsStoryboard);

// 6. "add storyboard" (EN) on a text goal → storyboard added, video NOT.
const gAddSb = analyzeDeterministic('add a storyboard');
check('add storyboard → needsStoryboard', gAddSb.outputs.needsStoryboard, gAddSb.outputs);
check('add storyboard → NOT needsVideo', !gAddSb.outputs.needsVideo, gAddSb.outputs);

// 7. "kịch bản" means SCRIPT. With a video it is video_script's job; alone it means a storyboard.
const gScriptVideo = analyzeDeterministic('viết kịch bản video cho sản phẩm');
check('kịch bản + video → needsVideo, NOT needsStoryboard', gScriptVideo.outputs.needsVideo && !gScriptVideo.outputs.needsStoryboard, gScriptVideo.outputs);
const gScriptOnly = analyzeDeterministic('viết kịch bản cho bài đăng facebook');
check('kịch bản alone → needsStoryboard', gScriptOnly.outputs.needsStoryboard && !gScriptOnly.outputs.needsVideo, gScriptOnly.outputs);

console.log(failures === 0 ? '\nPASS — storyboard/video independence green' : `\nFAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
