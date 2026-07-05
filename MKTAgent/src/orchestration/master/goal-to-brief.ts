// Map an extracted GoalSpec onto post brief fields (item 3 — agent-authored create).
// The Master Agent's requirement analyzer produces a GoalSpec from the user's free-text
// description; this projects the fields a Post brief cares about so the user never
// hand-fills the form. Pure + synchronous — trivially testable, no I/O.
import { assetTypeFromOutputs, type GoalSpec } from '../schemas/goal-spec.ts';
import type { CreatePostBody } from '../../api/schemas.ts';
import type { ClarificationQuestion } from './clarification-engine.ts';
import type { Campaign, SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

// Live Gemini emits "" (not null) for absent slots, so trim-then-null — NOT `?? null`,
// which would keep an empty string and mask the "nothing extracted" case.
const clean = (s?: string | null): string | null => (s && s.trim() ? s.trim() : null);

export interface GoalToBriefResult {
  brief: Omit<CreatePostBody, 'campaignId'>;
  // Human-readable names of the fields the agent actually populated (for UI confirmation).
  filled: string[];
}

// A post lives UNDER a campaign that already carries product/brand/audience context, so a
// brief only needs the per-post specifics. We ask for the high-impact ones the analyzer
// couldn't extract AND the campaign can't supply, so the post isn't generic:
//   • angle    — this post's specific topic/message (concept_writer's input). Required if
//                neither the message nor the campaign gives one → else copy is generic.
//   • platforms— only when the message names none AND the campaign has none (else inherit).
//   • format   — image vs video (optional; default image). Surfaced so the user can pick.
// Returns [] when nothing needs asking (create immediately). Pure — campaign is the row.
export const evaluateBriefClarification = (goal: GoalSpec, campaign: Campaign): ClarificationQuestion[] => {
  const qs: ClarificationQuestion[] = [];

  const angle = clean(goal.slots.angle);
  const campaignAngle = clean(campaign.angle);
  if (!angle && !campaignAngle) {
    qs.push({
      slot: 'angle',
      question: 'What is the specific message or angle for this post? (e.g. "Học AI trong 5 phút", a promo, a tip)',
      required: true,
    });
  }

  // Ask platforms whenever the MESSAGE itself didn't name them — do NOT silently inherit the
  // campaign's targets (the "it just used the campaign platforms without asking" surprise).
  // Same mandatory-platform rule as the Orchestrate flow so both Master-Agent surfaces match.
  if (goal.platforms.length === 0) {
    qs.push({
      slot: 'platforms',
      question: 'Which platforms should this post go to?',
      required: true,
      choices: ['facebook', 'instagram', 'threads', 'linkedin', 'x'],
      multiSelect: true,
    });
  }

  // Asset type is the deliverable — make it explicit (image | carousel | video) when the
  // message didn't clearly imply one (a bare request defaults to 'image' via the shared rule).
  // A clear "video"/"carousel"/"multiple images" request already resolved, so we don't re-ask.
  if (assetTypeFromOutputs(goal.outputs) === 'image') {
    qs.push({
      slot: 'assetType',
      question: 'What format for this post?',
      required: true,
      choices: ['image', 'carousel', 'video'],
    });
  }

  return qs;
};

// Clarification answers keyed by slot (from the modal's follow-up). A slot answer OVERRIDES
// the analyzer's extracted value — the user's explicit pick wins.
export type BriefAnswers = Partial<Record<'angle' | 'platforms' | 'assetType', string | string[]>>;

const asPlatforms = (v: string | string[] | undefined): SocialPlatform[] | undefined => {
  if (!v) return undefined;
  const arr = (Array.isArray(v) ? v : [v]).map((s) => s.trim().toLowerCase());
  const valid = arr.filter((s): s is SocialPlatform =>
    ['facebook', 'instagram', 'threads', 'linkedin', 'x'].includes(s));
  return valid.length ? valid : undefined;
};

export const goalToBrief = (goal: GoalSpec, answers: BriefAnswers = {}): GoalToBriefResult => {
  const language = clean(goal.slots.language);
  const lengthSpec = clean(goal.slots.lengthSpec);
  const angle = clean(typeof answers.angle === 'string' ? answers.angle : null) ?? clean(goal.slots.angle);
  const brandVoice = clean(goal.slots.brandVoice);
  // An explicit format answer wins; otherwise derive from the goal's outputs via the shared
  // rule (video ⇒ video, storyboard-only ⇒ carousel, else image) so the post's assetType
  // matches the deliverable the executor will produce.
  const answeredFormat = typeof answers.assetType === 'string' ? answers.assetType.trim().toLowerCase() : '';
  const assetType: CreatePostBody['assetType'] =
    answeredFormat === 'video' ? 'video'
    : answeredFormat === 'carousel' ? 'carousel'
    : answeredFormat === 'image' ? 'image'
    : assetTypeFromOutputs(goal.outputs);
  // Answered platforms win; else the analyzer's; else undefined so buildPostUnderCampaign
  // falls through to campaign inheritance rather than clobbering it with [].
  const platforms = asPlatforms(answers.platforms)
    ?? (goal.platforms.length ? (goal.platforms as SocialPlatform[]) : undefined);

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
