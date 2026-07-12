// GoalSpec — the structured intent extracted from a user's free-text goal.
// The RequirementAnalyzer (Phase 2) produces this; the WorkflowPlanner (Phase 1)
// consumes it. Rule-based planning keys off the boolean output flags + platforms,
// so the planner never needs the raw message. Zod is the single source of truth.
import { z } from 'zod';
import { socialPlatform } from '../../api/schemas.ts';

// What the user wants produced. These flags drive rule-based agent selection
// (brief §10): each maps to "add agent X" in the planner. Kept explicit (not a
// free enum) so the rule engine is exhaustive and testable.
export const outputFlags = z.object({
  // Full-campaign framing: ideate directions, then a strategy brief, before copy.
  // Default false so a plain "write a post" goal keeps the minimal copy→publish DAG.
  needsIdeation: z.boolean().default(false),
  needsStrategy: z.boolean().default(false),
  needsResearch: z.boolean().default(false),
  needsTextPost: z.boolean().default(true), // marketing posts almost always need copy
  needsInfographic: z.boolean().default(false),
  // Storyboard is an INDEPENDENT deliverable: usable for a post on its own. Video DEPENDS
  // ON it (video ⇒ storyboard, enforced in the planner), but not vice-versa — removing
  // video keeps storyboard. Default false so a plain post goal stays minimal.
  needsStoryboard: z.boolean().default(false),
  needsVideo: z.boolean().default(false),
  needsPublishing: z.boolean().default(true),
  // Email goal (P4-lite): the user wants Atria to WRITE + SEND an email (a happy-birthday note, a
  // one-off nurture). Routes to the email_writer → email_agent path INSTEAD of the social pipeline —
  // the analyzer forces the social flags off when this is set. Default false → unchanged for everyone.
  needsEmail: z.boolean().default(false),
});
export type OutputFlags = z.infer<typeof outputFlags>;

// Slots the ClarificationEngine (Phase 2) fills. Missing required slots → ask.
// Free-form strings mirror the existing config-as-data choice (T3): language and
// length are codes/labels, not enums, so any language scales without a schema change.
export const goalSlots = z.object({
  product: z.string().max(200).nullish(), // required slot — the thing being marketed
  // The real KNOWLEDGE about the product — what it is / does / its differentiator.
  // Distinct from `product` (the short name): this is the substance that grounds copy
  // (→ Campaign.brandContext) and the image prompt so neither comes out generic. A
  // bare "sản phẩm của tôi" fills `product` but leaves this empty (the thin-product gate).
  productDetails: z.string().max(4000).nullish(),
  targetAudience: z.string().max(400).nullish(),
  angle: z.string().max(2000).nullish(),
  brandVoice: z.string().max(2000).nullish(),
  // Who is marketing + the scope. Drives persona/voice and a compliance note. Maps onto
  // the existing User.accountType (business|personal); `company` collapses to business
  // for the copy persona path but keeps a distinct compliance/voice note.
  accountType: z.enum(['personal', 'business', 'company']).nullish(),
  language: z.string().max(40).nullish(),
  lengthSpec: z.string().max(40).nullish(),
  // Drive media file id(s) — 1 for image/video, CSV for carousel. The publisher
  // node materializes a Post with this heroFile; an empty heroFile makes the live
  // publish path fail-loud (correct: no media = nothing to post).
  heroFile: z.string().max(2000).nullish(),
  // Email goal slots (P4-lite). `emailTo` = recipient address(es), comma/semicolon separated; the
  // email_agent splits + validates them. `emailSubject` is an optional explicit subject (else the
  // writer proposes one). Only meaningful when outputs.needsEmail is true.
  emailTo: z.string().max(400).nullish(),
  emailSubject: z.string().max(200).nullish(),
});
export type GoalSlots = z.infer<typeof goalSlots>;

// The post's media assetType derived from the chosen outputs — the SINGLE rule mapping a
// plan to its deliverable, so post.assetType always matches what the flow produces (and the
// executor's media gating agrees). Priority: video ⇒ 'video'; storyboard-only ⇒ 'carousel'
// (the storyboard frames ARE the slides); else ⇒ 'image'.
// video ⇒ 'video'; storyboard-only ⇒ 'carousel'; an explicit image ⇒ 'image'; else (copy only,
// no media step) ⇒ 'text' — a text-only post that publishes without any asset (Fix D). Previously
// this defaulted to 'image', so a text-only flow produced an image-typed post with no image and the
// publisher failed "no asset (image)".
export const assetTypeFromOutputs = (o: OutputFlags): 'image' | 'carousel' | 'video' | 'text' =>
  o.needsVideo ? 'video' : o.needsStoryboard ? 'carousel' : o.needsInfographic ? 'image' : 'text';

// Campaign scope (Atria campaign-intelligence Phase 03). `single` = today's one-post flow
// (DEFAULT → byte-identical planning). `campaign` = a multi-post content plan across a duration.
// `spotlight` = one concentrated push (a short, high-intensity campaign). Non-single scopes route
// the planner to the campaign_strategist (research → strategy → editable N-slot content calendar)
// and STOP before per-post media/publish — those belong to the materialized posts (Phase 04).
export const campaignScope = z.enum(['single', 'campaign', 'spotlight']);
export type CampaignScope = z.infer<typeof campaignScope>;

// Generic scheduler slot (2026-07-12). First-class scheduling intent on the goal so ANY flow can
// defer its terminal action to a confirmed future time — scheduling is intent, not per-task plumbing.
//   at        = the absolute UTC instant (ISO 8601) Gemini parsed the phrase to; null until parsed.
//   phrase    = the raw natural-language time the user said ("sáng mai", "tomorrow 8am") — for audit.
//   timezone  = the IANA zone the instant was resolved in (recipient may differ from sender).
//   confirmed = the user EXPLICITLY confirmed the exact instant+tz. GATES planning of the scheduler
//               node: an unconfirmed schedule never parks a run (parse ambiguity + tz backstop).
export const scheduleSpec = z.object({
  at: z.string().nullish(),
  phrase: z.string().nullish(),
  timezone: z.string().nullish(),
  confirmed: z.boolean().default(false),
});
export type ScheduleSpec = z.infer<typeof scheduleSpec>;

export const goalSpec = z.object({
  // Stable goal classifier. Milestone 1 only plans `marketing_content`; the field
  // exists so future goal types (lead_nurture, report, etc.) slot in additively.
  goal: z.literal('marketing_content').default('marketing_content'),
  outputs: outputFlags,
  platforms: z.array(socialPlatform).default([]),
  slots: goalSlots,
  // Campaign framing (Phase 03). Default `single` keeps every existing goal on the unchanged
  // one-post path. duration/cadence are only meaningful when scope !== 'single'.
  campaignScope: campaignScope.default('single'),
  duration: z.object({ weeks: z.number().int().positive().max(52) }).nullish(),
  cadence: z.object({ postsPerWeek: z.number().int().positive().max(21) }).nullish(),
  // Deferred-execution schedule (2026-07-12). Nullish → an immediate flow (the default for everyone).
  // Set (confirmed) → the planner splices a `scheduler` node before the terminal action.
  schedule: scheduleSpec.nullish(),
  // Auto-publish preference (decision 2026-07-08). DEFAULT false → a cleanly-postable post STILL
  // halts at the approval gate; the user reviews then approves. The analyzer flips this true when
  // the message explicitly asks to publish without review ("đăng luôn", "auto publish", "no review")
  // so Atria honors a natural-language command; the /execute body toggle (UI) overrides it per-run.
  autoPublish: z.boolean().default(false),
  // Analyzer's self-reported confidence (mirrors the existing intake draft).
  confidence: z.number().min(0).max(1).default(0.5),
  // Which analyzer produced this (gemini | deterministic-v1) — for debugging.
  provider: z.string().default('deterministic-v1'),
});
export type GoalSpec = z.infer<typeof goalSpec>;
