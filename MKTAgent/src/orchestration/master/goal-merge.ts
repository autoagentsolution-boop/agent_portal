// Additive GoalSpec merge for conversational refinement. When a user follows up on
// an existing run ("…and add an image", "tôi muốn up ảnh nữa"), the new message is
// analyzed in isolation — product/audience/platforms it doesn't restate come back
// empty. Replacing the prior goal with that delta would lose everything already
// gathered (the re-asks-everything bug). Instead we merge: keep what we know, add
// what's new. Slots fill only when empty; platforms union; output flags OR (a turn
// can ADD media but never silently drop a requirement).
import { goalSpec, type GoalSpec } from '../schemas/goal-spec.ts';

const fillIfEmpty = (prior: string | null | undefined, delta: string | null | undefined): string | null | undefined =>
  (prior && prior.trim() ? prior : (delta && delta.trim() ? delta : prior));

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
      needsVideo: prior.outputs.needsVideo || delta.outputs.needsVideo,
      // Publishing is true by default; a refinement turn should never flip it off
      // (the user adding media still wants to publish). Keep prior unless prior was
      // explicitly draft-only and the delta re-enables it.
      needsPublishing: prior.outputs.needsPublishing || delta.outputs.needsPublishing,
    },
    platforms,
    slots: {
      product: fillIfEmpty(prior.slots.product, delta.slots.product),
      targetAudience: fillIfEmpty(prior.slots.targetAudience, delta.slots.targetAudience),
      angle: fillIfEmpty(prior.slots.angle, delta.slots.angle),
      brandVoice: fillIfEmpty(prior.slots.brandVoice, delta.slots.brandVoice),
      language: fillIfEmpty(prior.slots.language, delta.slots.language),
      lengthSpec: fillIfEmpty(prior.slots.lengthSpec, delta.slots.lengthSpec),
      heroFile: fillIfEmpty(prior.slots.heroFile, delta.slots.heroFile),
    },
    confidence: Math.max(prior.confidence, delta.confidence),
    provider: delta.provider,
  });
};
