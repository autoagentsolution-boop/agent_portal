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
  needsVideo: z.boolean().default(false),
  needsPublishing: z.boolean().default(true),
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
});
export type GoalSlots = z.infer<typeof goalSlots>;

export const goalSpec = z.object({
  // Stable goal classifier. Milestone 1 only plans `marketing_content`; the field
  // exists so future goal types (lead_nurture, report, etc.) slot in additively.
  goal: z.literal('marketing_content').default('marketing_content'),
  outputs: outputFlags,
  platforms: z.array(socialPlatform).default([]),
  slots: goalSlots,
  // Analyzer's self-reported confidence (mirrors the existing intake draft).
  confidence: z.number().min(0).max(1).default(0.5),
  // Which analyzer produced this (gemini | deterministic-v1) — for debugging.
  provider: z.string().default('deterministic-v1'),
});
export type GoalSpec = z.infer<typeof goalSpec>;
