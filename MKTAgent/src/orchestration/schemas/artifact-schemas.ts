// Artifact contracts — every agent output is a typed artifact (brief §3, §5).
// Downstream agents reference these by id; the executor validates an agent's
// output against the matching schema before storing (brief §6: validate-out).
// Keeping each payload Zod-defined means a malformed agent result is a recoverable
// error, not a silent bad input to the next node.
import { z } from 'zod';
import { copyBag, socialPlatform } from '../../api/schemas.ts';

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
  'content_calendar',
  'email_draft',
  'email_result',
  'schedule_marker',
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
  // Lead-scoring criteria the Strategist PROPOSES from the funnel stage/audience (Phase 02
  // Strategist ↔ Lead Collector bridge). Optional so legacy briefs + the LLM output (which
  // doesn't emit it) stay valid; the runner attaches it. Loosely shaped — the source of truth
  // is LeadScoringCriteria in leads/scoring/criteria.ts.
  leadScoringCriteria: z
    .object({
      sourceWeights: z.record(z.number()).optional(),
      unknownSourceWeight: z.number().optional(),
      baseWeight: z.number().optional(),
      phoneWeight: z.number().optional(),
      detailedMessageWeight: z.number().optional(),
      shortMessageWeight: z.number().optional(),
      detailedMessageMinLen: z.number().optional(),
    })
    .optional(),
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
  // Optimal-time suggestion recorded at the publish approval gate (Phase 02). Optional
  // so legacy artifacts + the DRY stub stay valid; a human-readable multi-line string.
  timingSuggestion: z.string().optional(),
});

// campaign_strategist → content_calendar (Atria Phase 03). An ordered set of planned posts
// (slots) the user reviews/edits before materializing into real scheduled Posts (Phase 04).
// `format` is the deliverable per slot; `dayOffset` is a spread hint (concrete dates assigned at
// materialization from the campaign's posting window + timezone).
export const calendarSlot = z.object({
  index: z.number().int().nonnegative(),
  pillar: z.string(),
  angle: z.string(),
  format: z.enum(['text', 'image', 'carousel', 'video']).default('image'),
  platforms: z.array(socialPlatform).default([]),
  hook: z.string().default(''),
  rationale: z.string().default(''),
  dayOffset: z.number().int().nonnegative().default(0),
});
export type CalendarSlot = z.infer<typeof calendarSlot>;

export const contentCalendar = z.object({
  slots: z.array(calendarSlot).min(1),
});

// email_writer → email_draft. A ready-to-review email: recipients + subject + plain-text body.
// `groundedOn` notes what the draft was built from (a content_concept, or the goal) for transparency.
export const emailDraft = z.object({
  to: z.array(z.string()).min(1),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  groundedOn: z.string().nullable().default(null),
});

// email_agent → email_result. Per-recipient send outcome (mirrors publish_result's shape). `dry_run`
// = the DRY verification/test seam (no real send). `sentIds` maps recipient → Gmail message id.
export const emailResult = z.object({
  to: z.array(z.string()).min(1),
  subject: z.string(),
  status: z.enum(['sent', 'partial', 'error', 'dry_run']),
  sentIds: z.record(z.string()).nullable().default(null),
  error: z.string().nullable().default(null),
});

// scheduler → schedule_marker (generic-scheduler node). A trivial, action-free marker recording the
// absolute UTC instant the run is parked to resume at + the tz it was confirmed in. The scheduler
// performs NO external action; this artifact just documents the park for the DAG/audit.
export const scheduleMarker = z.object({
  resumeAt: z.string(),
  timezone: z.string().nullable().default(null),
  phrase: z.string().nullable().default(null),
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
  content_calendar: contentCalendar,
  email_draft: emailDraft,
  email_result: emailResult,
  schedule_marker: scheduleMarker,
};
