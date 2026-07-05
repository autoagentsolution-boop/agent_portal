// Artifact contracts — every agent output is a typed artifact (brief §3, §5).
// Downstream agents reference these by id; the executor validates an agent's
// output against the matching schema before storing (brief §6: validate-out).
// Keeping each payload Zod-defined means a malformed agent result is a recoverable
// error, not a silent bad input to the next node.
import { z } from 'zod';
import { copyBag } from '../../api/schemas.ts';

// The closed set of artifact types produced in Milestone 1. Stubs emit the same
// shapes as future live agents will, so wiring a stub→live agent later needs no
// schema change (only the producing code changes).
export const artifactType = z.enum([
  'campaign_ideas',
  'strategy_brief',
  'research_summary',
  'content_concept',
  'infographic_brief',
  'storyboard',
  'video_prompt',
  'publish_result',
]);
export type ArtifactType = z.infer<typeof artifactType>;

// ideation → campaign_ideas. A handful of campaign directions plus the one the
// agent recommends pursuing, which strategy/concept downstream build on.
export const campaignIdeas = z.object({
  ideas: z.array(z.string()).min(1),
  chosen: z.string(),
});

// strategy → strategy_brief. Positioning + audience + content pillars + funnel
// stage — the narrative spine the concept writer turns into copy.
export const strategyBrief = z.object({
  positioning: z.string(),
  audience: z.string(),
  pillars: z.array(z.string()).default([]),
  funnelStage: z.string(),
});

// content_search → research_summary (stub in M1).
export const researchSummary = z.object({
  summary: z.string(),
  sourceNotes: z.array(z.string()).default([]),
});

// concept_writer → content_concept. Wraps the live copy-gen output (copyBag) plus
// the campaign angle/message so downstream media agents have the narrative.
export const contentConcept = z.object({
  mainAngle: z.string(),
  keyMessage: z.string(),
  copy: copyBag, // { body, threads, x } — the SELECTED variant (== variants[chosen])
  // 3-5 alternative copy versions the user chooses from at the concept selection gate.
  // `chosen` is the active index (post.copy mirrors variants[chosen]). Optional for back-compat
  // with legacy single-copy artifacts.
  variants: z.array(copyBag).optional(),
  chosen: z.number().int().optional(),
  // Reference to the real Post row this concept was generated against. The
  // publisher node uses this postId, NOT a copy of the text → Post stays the
  // single source of truth for content (plan: no second source of truth).
  postId: z.string().uuid(),
});

// infographic_agent → infographic_brief. imageRef points at the generated image
// (an AssetStore ref, e.g. `local:<path>`); null when no image was produced.
export const infographicBrief = z.object({
  visualBrief: z.string(),
  imagePrompt: z.string(),
  imageRef: z.string().nullable().default(null),
});

// storyboard_agent → storyboard: a set of REAL generated frame images introducing the
// product. imageRef is an AssetStore ref (local:<path>), served at /media/images.
export const storyboard = z.object({
  frames: z.array(
    z.object({
      index: z.number().int(),
      imageRef: z.string(),
      caption: z.string().default(''),
      imagePrompt: z.string().default(''),
    }),
  ),
});

// video_agent → video_prompt: the REAL rendered video (Veo i2v of the storyboard frames,
// stitched). videoRef is an AssetStore ref (local:<path>), served at /media/videos.
export const videoPrompt = z.object({
  videoRef: z.string(),
  durationSec: z.number().int().positive().default(8),
  clipCount: z.number().int().nonnegative().default(1),
});

// publisher_agent → publish_result. Mirrors the scheduler's per-platform outcome.
export const publishResult = z.object({
  postId: z.string().uuid(),
  status: z.enum(['posted', 'partial', 'error', 'dry_run', 'awaiting_approval']),
  postUrls: z.record(z.string()).nullable().default(null),
  error: z.string().nullable().default(null),
});

// Lookup: artifactType → its payload schema. The executor uses this to validate
// an agent's output by its declared `produces` type.
export const artifactSchemaFor: Record<ArtifactType, z.ZodTypeAny> = {
  campaign_ideas: campaignIdeas,
  strategy_brief: strategyBrief,
  research_summary: researchSummary,
  content_concept: contentConcept,
  infographic_brief: infographicBrief,
  storyboard,
  video_prompt: videoPrompt,
  publish_result: publishResult,
};
