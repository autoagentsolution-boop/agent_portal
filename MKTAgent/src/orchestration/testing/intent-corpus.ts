// Adversarial intent corpus (Phase 0 of the regex→LLM-intent migration). Each case is a message whose
// INTENT the regex classifiers historically got wrong (or would get wrong on a slightly harder phrasing),
// paired with the GoalSpec fields that matter. Two consumers:
//   - verify-intent-corpus.ts (unit): asserts the DETERMINISTIC regex path's known failures, so a
//     regression in the fallback is caught, and documents exactly which cases the regex CANNOT do.
//   - the live-gemini smoke in verify-master: asserts the MODEL gets each INTENT case right, which is the
//     evidence that lets Phase 2 drop the regex union.
// FACT cases (platform/@-recipient) are kept separate — those regex SHOULD get right and we keep them.

export interface IntentCase {
  id: string;
  message: string;
  // What a correct extraction must satisfy. Only the fields relevant to the case are asserted.
  expect: {
    campaignScope?: 'single' | 'campaign' | 'spotlight';
    autoPublish?: boolean;
    qualityPref?: 'economy' | 'standard' | 'high';
    needsPublishing?: boolean;
    needsVideo?: boolean;
    platformsInclude?: string[];   // platforms that MUST be present (FACT)
    platformsExclude?: string[];   // platforms that must NOT be present
    // Removal semantics: after this message, which output flags / platforms should be OFF.
    removedOutputs?: string[];     // e.g. ['video']
    removedPlatforms?: string[];   // e.g. ['facebook']
    noRemoval?: boolean;           // the message must NOT be read as any removal
    isEmail?: boolean;
  };
  // Why the regex classifier fails (or is fragile) here — documentation, not asserted.
  regexWeakness: string;
}

// ── FALSE-REMOVAL: a removal verb sits in the message but modifies something else ────────────────────
export const FALSE_REMOVAL_CASES: IntentCase[] = [
  {
    id: 'publish-without-review',
    message: 'Plan a month of content for GreenLeaf on Facebook, publish automatically without review, high quality',
    expect: { noRemoval: true, campaignScope: 'campaign', autoPublish: true, qualityPref: 'high', needsPublishing: true, platformsInclude: ['facebook'] },
    regexWeakness: '"without" (removal verb) + "publish" (target) in different clauses — regex dropped publishing AND facebook',
  },
  {
    id: 'no-longer-just-fb',
    message: 'I no longer want just Facebook — post to Instagram and Threads too',
    expect: { noRemoval: true, platformsInclude: ['instagram', 'threads'] },
    regexWeakness: '"no longer" is a removal verb but the sentence is ADDITIVE (expanding platforms)',
  },
  {
    id: 'without-a-doubt',
    message: 'Without a doubt make a bold video ad for our launch on TikTok feel',
    expect: { noRemoval: true, needsVideo: true },
    regexWeakness: '"without a doubt" trips the removal verb; "video" is a target → regex would drop the video the user wants',
  },
];

// ── NESTED NEGATION: an explicit "don't X but do Y" the regex cannot parse ───────────────────────────
export const NESTED_NEGATION_CASES: IntentCase[] = [
  {
    id: 'dont-fb-do-ig',
    message: "Don't publish to Facebook, but do post to Instagram",
    expect: { platformsInclude: ['instagram'], platformsExclude: ['facebook'], needsPublishing: true },
    regexWeakness: 'regex sees both facebook+instagram and a removal verb near facebook → ambiguous; cannot express "drop fb, keep ig"',
  },
];

// ── TRUE REMOVAL (refine turn): must STILL be caught after the migration ─────────────────────────────
export const TRUE_REMOVAL_CASES: IntentCase[] = [
  { id: 'remove-facebook', message: 'remove facebook', expect: { removedPlatforms: ['facebook'] }, regexWeakness: 'n/a — regex handles this; kept as a regression guard' },
  { id: 'without-a-video', message: 'without a video', expect: { removedOutputs: ['video'] }, regexWeakness: 'n/a — simple removal, model must not miss it either' },
  { id: 'bo-video-storyboard', message: 'bỏ luôn video và storyboard đi', expect: { removedOutputs: ['video', 'storyboard'] }, regexWeakness: 'VN word order; regex handles, model must too' },
  { id: 'drop-the-infographic', message: 'drop the infographic', expect: { removedOutputs: ['infographic'] }, regexWeakness: 'n/a — regression guard' },
];

// ── FACT extraction (platform / recipient) — regex KEEPS these; model must not lose them ────────────
export const FACT_CASES: IntentCase[] = [
  { id: 'fb-and-ig', message: 'Escribe una publicación para Facebook e Instagram sobre nuestro café', expect: { platformsInclude: ['facebook', 'instagram'] }, regexWeakness: 'n/a — model drops one of a multi-platform list; regex union recovers it (FACT, kept)' },
  { id: 'on-facebook-campaign', message: 'Plan a month of content for GreenLeaf on Facebook, 3 posts a week', expect: { platformsInclude: ['facebook'], campaignScope: 'campaign' }, regexWeakness: 'brain paraphrase drops "Facebook"; regex union recovers (FACT, kept)' },
];

// ── SCOPE (memory bleed vs real escalation) ─────────────────────────────────────────────────────────
export const SCOPE_CASES: IntentCase[] = [
  { id: 'single-asset-not-campaign', message: 'Make one infographic for Nắng Sớm for Instagram', expect: { campaignScope: 'single', platformsInclude: ['instagram'] }, regexWeakness: 'recalled campaign scope bled onto a one-off (F19)' },
  { id: 'real-campaign', message: 'Plan a full month of weekly posts for our coffee, a real campaign', expect: { campaignScope: 'campaign' }, regexWeakness: 'n/a — must still escalate' },
];

export const ALL_INTENT_CASES: IntentCase[] = [
  ...FALSE_REMOVAL_CASES, ...NESTED_NEGATION_CASES, ...TRUE_REMOVAL_CASES, ...SCOPE_CASES,
];
export const ALL_FACT_CASES: IntentCase[] = FACT_CASES;
