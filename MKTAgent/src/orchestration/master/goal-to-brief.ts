// Map an extracted GoalSpec onto post brief fields (item 3 — agent-authored create).
// The Master Agent's requirement analyzer produces a GoalSpec from the user's free-text
// description; this projects the fields a Post brief cares about so the user never
// hand-fills the form. Pure + synchronous — trivially testable, no I/O.
import type { GoalSpec } from '../schemas/goal-spec.ts';
import type { CreatePostBody } from '../../api/schemas.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

// Live Gemini emits "" (not null) for absent slots, so trim-then-null — NOT `?? null`,
// which would keep an empty string and mask the "nothing extracted" case.
const clean = (s?: string | null): string | null => (s && s.trim() ? s.trim() : null);

export interface GoalToBriefResult {
  brief: Omit<CreatePostBody, 'campaignId'>;
  // Human-readable names of the fields the agent actually populated (for UI confirmation).
  filled: string[];
}

export const goalToBrief = (goal: GoalSpec): GoalToBriefResult => {
  const language = clean(goal.slots.language);
  const lengthSpec = clean(goal.slots.lengthSpec);
  const angle = clean(goal.slots.angle);
  const brandVoice = clean(goal.slots.brandVoice);
  // Carousel is never inferred (needs explicit media intent) — YAGNI. Video only when the
  // goal asked for it; everything else is a single image.
  const assetType: CreatePostBody['assetType'] = goal.outputs.needsVideo ? 'video' : 'image';
  // Empty → undefined so buildPostUnderCampaign falls through to campaign inheritance
  // rather than clobbering the campaign's platforms with [].
  const platforms = goal.platforms.length ? (goal.platforms as SocialPlatform[]) : undefined;

  const filled: string[] = ['asset type'];
  if (language) filled.push('language');
  if (lengthSpec) filled.push('length');
  if (angle) filled.push('angle');
  if (brandVoice) filled.push('brand voice');
  if (platforms) filled.push('platforms');

  return {
    brief: {
      assetType,
      language,
      lengthSpec,
      angle,
      brandVoice,
      ...(platforms ? { platforms } : {}),
    },
    filled,
  };
};
