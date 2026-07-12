// Additive GoalSpec merge for conversational refinement. When a user follows up on
// an existing run ("…and add an image", "tôi muốn up ảnh nữa"), the new message is
// analyzed in isolation — product/audience/platforms it doesn't restate come back
// empty. Replacing the prior goal with that delta would lose everything already
// gathered (the re-asks-everything bug). Instead we merge: keep what we know, add
// what's new. Slots fill only when empty; platforms union; output flags OR (a turn
// can ADD media but never silently drop a requirement).
import { goalSpec, type GoalSpec, type ScheduleSpec } from '../schemas/goal-spec.ts';
import type { Removals } from './deterministic-analyzer.ts';

// Schedule survives a refinement turn: a freshly-analyzed delta carries no schedule (the analyzer
// doesn't parse time — the set_schedule tool does, then propose_workflow overlays it), so the prior
// schedule must not be dropped. When BOTH carry one, the later turn's set fields win (re-schedule),
// and confirmed is OR'd so a confirmed instant isn't silently un-confirmed by a slot-only delta.
const mergeSchedule = (
  prior: ScheduleSpec | null | undefined,
  delta: ScheduleSpec | null | undefined,
): ScheduleSpec | null | undefined => {
  if (!delta) return prior;
  if (!prior) return delta;
  return {
    at: delta.at ?? prior.at,
    phrase: delta.phrase ?? prior.phrase,
    timezone: delta.timezone ?? prior.timezone,
    confirmed: delta.confirmed || prior.confirmed,
  };
};

const fillIfEmpty = (prior: string | null | undefined, delta: string | null | undefined): string | null | undefined =>
  (prior && prior.trim() ? prior : (delta && delta.trim() ? delta : prior));

// productDetails is CUMULATIVE product knowledge, not a single-shot slot. A clarification /
// refine turn that adds detail must APPEND to what we already know — fillIfEmpty would DROP it
// (prior non-empty → keep prior), which made the product-depth probe re-ask forever because the
// answer never landed. Append (deduped) so each answer grows the profile and the probe clears.
const accumulate = (prior: string | null | undefined, delta: string | null | undefined): string | null | undefined => {
  const p = (prior ?? '').trim();
  const d = (delta ?? '').trim();
  if (!d) return prior;
  if (!p) return d;
  if (p.includes(d)) return prior; // already captured — don't duplicate on repeated merges
  return `${p} ${d}`;
};

export const mergeGoals = (prior: GoalSpec, delta: GoalSpec): GoalSpec => {
  const platforms = Array.from(new Set([...prior.platforms, ...delta.platforms])) as GoalSpec['platforms'];
  return goalSpec.parse({
    goal: prior.goal,
    outputs: {
      needsIdeation: prior.outputs.needsIdeation || delta.outputs.needsIdeation,
      needsStrategy: prior.outputs.needsStrategy || delta.outputs.needsStrategy,
      needsResearch: prior.outputs.needsResearch || delta.outputs.needsResearch,
      needsTextPost: prior.outputs.needsTextPost || delta.outputs.needsTextPost,
      needsInfographic: prior.outputs.needsInfographic || delta.outputs.needsInfographic,
      needsStoryboard: prior.outputs.needsStoryboard || delta.outputs.needsStoryboard,
      needsVideo: prior.outputs.needsVideo || delta.outputs.needsVideo,
      // Publishing is true by default; a refinement turn should never flip it off
      // (the user adding media still wants to publish). Keep prior unless prior was
      // explicitly draft-only and the delta re-enables it.
      needsPublishing: prior.outputs.needsPublishing || delta.outputs.needsPublishing,
      // Email intent MUST survive a refine/confirm turn. A bare delta ("đúng vậy", a schedule
      // confirm) analyzes as needsEmail=false, so without this OR the goal silently reverts from
      // the email path to the social pipeline (dropping recipient + schedule → the scheduler node
      // never splices). The planner's email branch short-circuits, so co-set social flags are inert.
      needsEmail: prior.outputs.needsEmail || delta.outputs.needsEmail,
    },
    platforms,
    slots: {
      product: fillIfEmpty(prior.slots.product, delta.slots.product),
      productDetails: accumulate(prior.slots.productDetails, delta.slots.productDetails),
      accountType: prior.slots.accountType ?? delta.slots.accountType,
      targetAudience: fillIfEmpty(prior.slots.targetAudience, delta.slots.targetAudience),
      angle: fillIfEmpty(prior.slots.angle, delta.slots.angle),
      brandVoice: fillIfEmpty(prior.slots.brandVoice, delta.slots.brandVoice),
      language: fillIfEmpty(prior.slots.language, delta.slots.language),
      lengthSpec: fillIfEmpty(prior.slots.lengthSpec, delta.slots.lengthSpec),
      heroFile: fillIfEmpty(prior.slots.heroFile, delta.slots.heroFile),
      // Email recipient/subject: carry across turns so a later confirm/schedule turn (whose delta
      // has no address) keeps who the email is for. Paired with needsEmail above.
      emailTo: fillIfEmpty(prior.slots.emailTo, delta.slots.emailTo),
      emailSubject: fillIfEmpty(prior.slots.emailSubject, delta.slots.emailSubject),
      // sourceText: the input for a non-marketing utility task (summarize). A refine turn's delta
      // carries none, so keep prior — else the merged goal loses the very text it operates on.
      sourceText: fillIfEmpty(prior.slots.sourceText, delta.slots.sourceText),
    },
    // taskTargets: a NON-marketing task goal is selected backward from these. mergeGoals otherwise
    // rebuilds a marketing-shaped goal (taskTargets undefined) → the task silently reverts to a publish
    // flow on any refine. Carry prior unless the delta explicitly re-targets (delta wins). Latent until a
    // 2nd task capability or multi-turn task refine makes propose_workflow-on-a-task a normal path.
    taskTargets: delta.taskTargets ?? prior.taskTargets,
    schedule: mergeSchedule(prior.schedule, delta.schedule),
    // qualityPref (Phase 06): survives refine — a marketing delta analyzes as the 'standard' default, so
    // without this a user's stated "chất lượng cao"/"high quality" is silently reset on the next turn.
    // A later turn that states a NEW preference (non-default) wins; else keep what was gathered.
    qualityPref: delta.qualityPref !== 'standard' ? delta.qualityPref : prior.qualityPref,
    confidence: Math.max(prior.confidence, delta.confidence),
    provider: delta.provider,
  });
};

// Subtractive refinement: apply a removal delta AFTER the additive merge so a turn
// like "bỏ video / remove facebook" actually un-sets things (mergeGoals alone is
// additive and would keep them). Turns off named output flags and subtracts named
// platforms. Guard: never produce an unplannable goal — keep at least a text post,
// and if dropping platforms would empty a publishing goal, keep publishing on so the
// clarification engine re-asks for a platform rather than planning an orphan publish.
export const applyRemovals = (goal: GoalSpec, removals: Removals): GoalSpec => {
  if (removals.disableOutputs.length === 0 && removals.dropPlatforms.length === 0) return goal;

  const next = goalSpec.parse(goal);
  const disable = new Set(removals.disableOutputs);
  if (disable.has('ideation')) next.outputs.needsIdeation = false;
  if (disable.has('strategy')) next.outputs.needsStrategy = false;
  if (disable.has('research')) next.outputs.needsResearch = false;
  if (disable.has('infographic')) next.outputs.needsInfographic = false;
  // Video depends on storyboard: removing VIDEO keeps storyboard (still usable for a post),
  // but removing STORYBOARD must also drop video (can't produce a video without one).
  if (disable.has('video')) next.outputs.needsVideo = false;
  if (disable.has('storyboard')) { next.outputs.needsStoryboard = false; next.outputs.needsVideo = false; }
  if (disable.has('publishing')) next.outputs.needsPublishing = false;

  if (removals.dropPlatforms.length) {
    const drop = new Set<string>(removals.dropPlatforms);
    next.platforms = next.platforms.filter((p) => !drop.has(p)) as GoalSpec['platforms'];
  }

  // Empty-plan guard: a goal with no real deliverable can't plan. Fall back to a text post
  // (the minimal marketing deliverable) so removal never yields a blank/unplannable DAG.
  // storyboard is INTERMEDIATE (frames feeding a video/carousel), not a standalone deliverable —
  // a storyboard-only goal has no terminal output AND its content_concept dep is unsatisfiable, so
  // it must fall back to a text post too. Hence storyboard is excluded from the "has output" check.
  const anyOutput =
    next.outputs.needsIdeation || next.outputs.needsStrategy || next.outputs.needsResearch ||
    next.outputs.needsTextPost || next.outputs.needsInfographic || next.outputs.needsVideo;
  if (!anyOutput) next.outputs.needsTextPost = true;

  return next;
};
