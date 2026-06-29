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
  'research_summary',
  'content_concept',
  'infographic_brief',
  'storyboard',
  'video_prompt',
  'publish_result',
]);
export type ArtifactType = z.infer<typeof artifactType>;

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
  copy: copyBag, // { body, threads, x } — the live copy-gen result
  // Reference to the real Post row this concept was generated against. The
  // publisher node uses this postId, NOT a copy of the text → Post stays the
  // single source of truth for content (plan: no second source of truth).
  postId: z.string().uuid(),
});

// infographic_agent → infographic_brief (stub in M1).
export const infographicBrief = z.object({
  visualBrief: z.string(),
  imagePrompt: z.string(),
});

// storyboard_agent → storyboard (stub in M1).
export const storyboard = z.object({
  scenes: z.array(z.object({ index: z.number().int(), instruction: z.string() })),
  videoScript: z.string(),
});

// video_agent → video_prompt (stub in M1).
export const videoPrompt = z.object({
  prompt: z.string(),
  durationSec: z.number().int().positive().default(8),
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
  research_summary: researchSummary,
  content_concept: contentConcept,
  infographic_brief: infographicBrief,
  storyboard,
  video_prompt: videoPrompt,
  publish_result: publishResult,
};
