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
  // video_script (2026-07-21): the narrative plan a video is rendered FROM — shot list, per-shot
  // motion + duration, spoken narration, hook and CTA. Video used to derive all of this from
  // `storyboard` frames, which are composed for stills; a still-image prompt is not a motion
  // prompt, so the video node was reading the wrong artifact. video now requires THIS instead.
  'video_script',
  'video_prompt',
  'publish_result',
  'content_calendar',
  'email_draft',
  'email_result',
  'schedule_marker',
  // DM nurture (Multi-channel Nurture Nodes Phase 01): a drafted, then sent, opt-in direct message
  // (WhatsApp / Telegram / Zalo). Mirrors email_draft/email_result.
  'dm_draft',
  'dm_result',
  // Wall-greeting (Multi-channel Nurture Nodes Phase 02): a drafted, then posted, public
  // person-directed greeting (an @mention in our own post, or a reply to theirs) — fanned out to
  // every goal.platforms target. Mirrors dm_draft/dm_result but multi-platform (like publish_result).
  'greeting_draft',
  'greeting_result',
  // Utility capability (P1b Phase 05): summarize — the first NON-marketing producer node, proving the
  // registry is a general composable graph (drop-in via registry entry + runner, no planner change).
  'summary',
  // Data-protection capability: security — scans source text for personal / sensitive data (GDPR/PII),
  // masks it, and announces what it found. Runs BEFORE summarize so nothing sensitive reaches the summary.
  'security_scan',
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
// aspectRatio + onImageText added 2026-07-21 when the node stopped filling a fixed string template
// and started PLANNING the visual. Both optional so artifacts stored before that still parse.
export const infographicBrief = z.object({
  visualBrief: z.string(),
  imagePrompt: z.string(),
  imageRef: z.string().nullable().default(null),
  // Chosen from the post's target platforms (1:1 feed, 9:16 story/reels, 16:9 landscape).
  aspectRatio: z.enum(['1:1', '9:16', '16:9']).default('1:1'),
  // The short text lines the image itself carries, in the run language — an overview explainer is
  // text-bearing by definition. Empty array = a deliberately text-free visual.
  onImageText: z.array(z.string()).default([]),
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
// video_script_agent → video_script: the plan the video node RENDERS. Deliberately carries the two
// things a storyboard frame cannot: `motion` (how the shot changes over time, for Veo) and
// `narration` (a line written to be SPOKEN, not an image caption). Durations are per-shot so a
// platform-appropriate total replaces the old hardcoded 8s-per-frame.
export const videoScript = z.object({
  // The platform whose length/pacing conventions the script was written for (informational; the
  // runner does not branch on it — the durations already encode the decision).
  platform: z.string().default(''),
  hook: z.string(),
  cta: z.string(),
  totalDurationSec: z.number().int().positive(),
  shots: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        // ENGLISH — generates the keyframe still.
        imagePrompt: z.string().min(1),
        // ENGLISH — camera move + subject action + pacing. Drives Veo i2v.
        motion: z.string().min(1),
        // RUN LANGUAGE — one line describing what this shot shows and does, for the HUMAN reviewing
        // the script at the cost gate. imagePrompt/motion are English because the image and video
        // models perform best in English; showing those raw to the user produced a card that was
        // half their language and half English. Mirrors infographic's visualBrief/imagePrompt split.
        // Optional so scripts generated before this field existed still parse.
        brief: z.string().default(''),
        // Run language — spoken aloud by TTS.
        narration: z.string().default(''),
        // Veo renders only 4, 6 or 8 second clips, and the CONTRACT tells the model exactly that —
        // but the schema stays permissive on purpose. Rejecting a whole script because one shot came
        // back as 5 would fail the run over something `snapDuration` fixes for free; the runner
        // snaps every value before the artifact is persisted, so stored scripts are always valid.
        durationSec: z.number().int().positive(),
      }),
    )
    .min(1),
});

// shotCount + degraded added 2026-07-21: a keyframe or clip can fail (the image model returns
// 200-with-no-image ~1/3 of the time), and silently shipping a 3-shot video from a 6-shot script
// reads to the user as bad quality rather than partial failure. Optional so older rows still parse.
export const videoPrompt = z.object({
  videoRef: z.string(),
  durationSec: z.number().int().positive().default(8),
  clipCount: z.number().int().nonnegative().default(1),
  shotCount: z.number().int().nonnegative().default(0),
  degraded: z.boolean().default(false),
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
// = the DRY verification/test seam (no real send). `sentIds` maps recipient → Gmail's internal
// message id. `threadIds`/`messageIds` (Lead Nurture Agent Phase 02) map recipient → Gmail's
// conversation id / OUR generated RFC Message-ID — nurture-runner.ts persists both onto the thread so
// the NEXT touch's send carries them as threadId/In-Reply-To (HARD invariant #6, single conversation).
export const emailResult = z.object({
  to: z.array(z.string()).min(1),
  subject: z.string(),
  status: z.enum(['sent', 'partial', 'error', 'dry_run']),
  sentIds: z.record(z.string()).nullable().default(null),
  threadIds: z.record(z.string()).nullable().default(null),
  messageIds: z.record(z.string()).nullable().default(null),
  error: z.string().nullable().default(null),
});

// dm_writer/dm_agent → dm_draft/dm_result (Multi-channel Nurture Nodes Phase 01). Mirrors
// email_draft/email_result but for a single opt-in DM channel (whatsapp|telegram|zalo) instead of
// email addresses. `to` is the channel's own recipient address (phone / chat-id / handle).
export const dmChannel = z.enum(['whatsapp', 'telegram', 'zalo']);

export const dmDraft = z.object({
  channel: dmChannel,
  to: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  groundedOn: z.string().nullable().default(null),
});

// `dry_run` = the DRY-RUN/verification seam (no real message sent) — mirrors email_result's dry_run.
export const dmResult = z.object({
  channel: dmChannel,
  to: z.string().min(1).max(200),
  status: z.enum(['sent', 'dry_run', 'error']),
  platformMessageId: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});

// greeting_writer/greeting_agent → greeting_draft/greeting_result (Multi-channel Nurture Nodes
// Phase 02). `target` is the @handle (mention) or the platform-native post id (reply) — a free-form
// string kept action-agnostic, validated inside the runner/adapter, mirroring dm's `to`.
export const greetingAction = z.enum(['mention', 'reply']);

export const greetingDraft = z.object({
  action: greetingAction,
  target: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  groundedOn: z.string().nullable().default(null),
});

// One platform's outcome — mirrors PublishResult (src/social/types.ts) so the aggregation logic is
// the same shape the publisher already uses (multi-platform fan-out, unlike a single-channel DM).
export const greetingPlatformResult = z.object({
  platform: socialPlatform,
  ok: z.boolean(),
  url: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  degraded: z.boolean().optional(),
  // True when this platform's outcome was a SIMULATED DRY-RUN (no network call) — see
  // src/social/greeting.ts's isLiveGreetingSend.
  dryRun: z.boolean().optional(),
});

// `dry_run` = every targeted platform was simulated (mirrors dm_result's dry_run). `partial` = some
// platforms ok, some not (mirrors publish_result). A total failure throws in the runner instead of
// reaching here (fail-loud, like publisher/email_agent) — so `error` never appears on this artifact.
export const greetingResult = z.object({
  action: greetingAction,
  target: z.string(),
  status: z.enum(['sent', 'partial', 'dry_run']),
  results: z.array(greetingPlatformResult).min(1),
});

// scheduler → schedule_marker (generic-scheduler node). A trivial, action-free marker recording the
// absolute UTC instant the run is parked to resume at + the tz it was confirmed in. The scheduler
// performs NO external action; this artifact just documents the park for the DAG/audit.
export const scheduleMarker = z.object({
  resumeAt: z.string(),
  timezone: z.string().nullable().default(null),
  phrase: z.string().nullable().default(null),
});

// summarize → summary. A concise summary of user-provided source text, plus optional key bullets.
// The first non-marketing utility artifact; email_writer can optionally ground on it (summarize → email).
export const summaryArtifact = z.object({
  summary: z.string().min(1),
  bullets: z.array(z.string()).default([]),
  // True when the summarized text had been masked upstream by the security node — so the UI can note
  // that the summary is derived from a redacted source (no personal/sensitive data in it).
  fromMaskedSource: z.boolean().default(false),
});

// security → security_scan. Data-protection pass over source text: which categories of personal/sensitive
// data (GDPR/PII) were found, the source with those spans MASKED, and a plain-language notice to show the
// user. `example` fields are ALREADY MASKED — raw PII never lands in an artifact. Runs before summarize.
export const securityFinding = z.object({
  category: z.enum(['personal', 'contact', 'financial', 'government_id', 'health', 'credentials', 'other']),
  count: z.number().int().nonnegative().default(1),
  example: z.string().default(''), // a MASKED sample or category label, e.g. "j***@***" — never a raw value
});
export const securityScanArtifact = z.object({
  hasSensitive: z.boolean(),
  findings: z.array(securityFinding).default([]),
  maskedText: z.string(), // source with every sensitive span replaced by a [CATEGORY] token
  notice: z.string().default(''), // user-facing announcement of what was found + masked
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
  video_script: videoScript,
  video_prompt: videoPrompt,
  publish_result: publishResult,
  content_calendar: contentCalendar,
  email_draft: emailDraft,
  email_result: emailResult,
  schedule_marker: scheduleMarker,
  dm_draft: dmDraft,
  dm_result: dmResult,
  greeting_draft: greetingDraft,
  greeting_result: greetingResult,
  summary: summaryArtifact,
  security_scan: securityScanArtifact,
};
