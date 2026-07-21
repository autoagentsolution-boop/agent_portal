// OUTPUT CONTRACTS — the strict, per-agent JSON-shape tail of every agent system prompt.
//
// Phase 01 split the old flat system prompts into two layers:
//   • the EXPERT BASE (persona + frameworks + quality bar) now lives as registry
//     `promptSections` data (registry/agent-registry.ts), authored to expert grade;
//   • the OUTPUT CONTRACT (the exact JSON shape + per-field rules + JSON-only rule)
//     stays here, ported VERBATIM from the flat prompts so the artifact schemas are
//     unchanged and no runner/validator breaks.
// `buildAgentPrompt` (build-agent-prompt.ts) is the ONE place that stitches
// base → language → [user instructions] → contract into a single system prompt.
//
// Contracts are keyed by a stable string (usually the agentId). The storyboard agent
// has TWO output shapes (cinematic video vs swipeable carousel) selected by the runner
// at run time, so it exposes two contract keys.

export type ContractKey =
  | 'ideation'
  | 'strategy'
  | 'infographic'
  | 'storyboard'
  | 'storyboard_carousel'
  | 'video_script'
  | 'campaign_strategist';

const ideation = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "ideas": ["direction 1", "direction 2", "direction 3"],
  "chosen": "the single direction you recommend pursuing"
}
- Ground every idea in the provided product knowledge — do not invent capabilities or claims beyond them.
- 3-5 ideas, each one concise sentence describing an angle/hook.
- "chosen" must be one of the ideas (verbatim or a tightened version).
- Write EVERY idea entirely in the LANGUAGE specified above. Never use another language — not even the language of the product's name — and never mix languages.
- Output JSON only. No prose, no markdown fences.`;

const strategy = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "positioning": "how the product is positioned in one or two sentences",
  "audience": "the primary target audience",
  "pillars": ["content pillar 1", "content pillar 2", "content pillar 3"],
  "funnelStage": "awareness|consideration|conversion|retention"
}
- Ground the brief in the provided product knowledge — do not invent capabilities or claims beyond them.
- 2-4 pillars, each a short phrase.
- funnelStage must be one of the four listed values (these enum values stay in English; ALL other text follows the LANGUAGE rule above).
- Write EVERY other field entirely in the LANGUAGE specified above. Never use another language and never mix languages.
- Output JSON only. No prose, no markdown fences.`;

// infographic — the product OVERVIEW explainer (one image). Distinct from storyboard, which covers
// feature DETAIL across several images. Text on the image is expected here: an overview that explains
// nothing in words is a stock photo. Until 2026-07-21 this node had no contract at all — it filled a
// fixed string template and hardcoded "no text overlay", which is why every image looked the same.
const infographic = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "imagePrompt": "a detailed ENGLISH prompt for an image generator: subject, layout, composition, lighting, style, and where the text blocks sit",
  "visualBrief": "one or two sentences describing the planned image, for the user to review",
  "onImageText": ["short line that appears on the image", "another short line"],
  "aspectRatio": "1:1|9:16|16:9"
}
- This is ONE image that explains the product AT A GLANCE. Give it a readable structure — e.g. problem → solution → benefit, or a labelled breakdown of what the product is. Not a decorative product beauty shot.
- "onImageText" is 0 to 5 SHORT lines (each under ~40 characters) written ENTIRELY in the LANGUAGE specified above. These are the words rendered ON the image. Use an empty array only when the visual genuinely communicates better without words.
- "imagePrompt" is ENGLISH (image models perform best in English) and must describe WHERE the text sits in the layout, quoting each line from "onImageText" verbatim so the renderer places it. Ground every claim in the provided product knowledge — invent nothing beyond it.
- Choose "aspectRatio" from the post's target platforms: 1:1 for a feed post, 9:16 for story/reels/tiktok, 16:9 for landscape/youtube. Default 1:1 when unclear.
- It must read at THUMBNAIL scale: few words, high contrast, one focal point. Reject a layout that only works at full size.
- "visualBrief" is written in the LANGUAGE specified above (the user reads it). "imagePrompt" stays English. Do not mix languages within either field.
- Output JSON only. No prose, no markdown fences.`;

const storyboard = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "frames": [
    { "index": 0, "imagePrompt": "a detailed English prompt for an image generator: subject, composition, lighting, style", "caption": "a short caption for this frame" }
  ]
}
- 3 to 6 frames. index starts at 0 and increments by 1 in visual order (e.g. wide establishing shot → detail → context/use → call-to-action).
- CONSISTENCY IS REQUIRED: every frame depicts the SAME product/subject with the SAME visual style. Begin every "imagePrompt" with one shared style+subject anchor phrase (identical wording) then add what is unique to that frame.
- "imagePrompt" is written in ENGLISH (image models perform best in English), concrete and photographic, grounded in the product knowledge — do not invent features or claims beyond them.
- "caption" MUST be written in the LANGUAGE specified above (these captions become the video voiceover). Do not mix languages in captions.
- Output JSON only. No prose, no markdown fences.`;

const storyboardCarousel = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "frames": [
    { "index": 0, "imagePrompt": "a detailed English prompt for an image generator: subject, composition, style", "caption": "the on-slide text for this frame" }
  ]
}
- 4 to 6 slides forming ONE clear narrative the reader swipes through: hook/problem → what the product is → how it works → key benefits / who it helps → call to action.
- Each slide is a COMPLETE, self-contained marketing image (product-in-context, screens/UI, a simple workflow diagram, before→after, benefit visuals) — NOT a movie still of a person.
- CONSISTENCY: one shared visual style + brand look across ALL slides. Begin every "imagePrompt" with one identical style+brand anchor phrase, then add what is unique to that slide.
- "imagePrompt" is written in ENGLISH, grounded in the product knowledge — invent nothing beyond it.
- "caption" is the on-slide copy, written ENTIRELY in the LANGUAGE specified above — never mix languages.
- Output JSON only. No prose, no markdown fences.`;

// video_script — the narrative a video is rendered FROM. The two fields that justify this node
// existing are "motion" and "narration": a storyboard frame carries neither, so before this the video
// node fed a STILL-composition prompt to a motion model and spoke image captions aloud.
const videoScript = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "platform": "the platform this is cut for",
  "hook": "the opening line that earns the first 3 seconds",
  "cta": "the closing call to action",
  "totalDurationSec": 24,
  "shots": [
    { "index": 0, "imagePrompt": "ENGLISH prompt for the keyframe still: subject, composition, lighting, style", "motion": "ENGLISH description of how this shot MOVES: camera move, subject action, pacing", "brief": "one short line describing this shot, for the human reviewing the script", "narration": "the line spoken over this shot", "durationSec": 4 }
  ]
}
- SHOT COUNT AND TOTAL RUNTIME ARE SET BY THE "Video runtime" DIRECTIVE ABOVE — obey the shot range and the target total it states. Never substitute your own idea of a good length. index starts at 0 and increments by 1 in playback order.
- SHOT 0 IS THE HOOK. It must land the "hook" line and its durationSec must be 4. Retention on short video is decided in the first three seconds; do not open with a slow establishing shot.
- THE FINAL SHOT IS THE CTA and must land the "cta" line.
- "durationSec" is EXACTLY one of 4, 6 or 8 (the video model renders only these lengths).
- "totalDurationSec" MUST equal the sum of every shot's durationSec.
- Cut for the VIDEO TARGET stated above, not for the publish platforms — they answer different questions ("where it gets posted" vs "how it is edited"). The target sets RHYTHM and ASPECT: vertical short-form (reels, tiktok, shorts) cuts fast and hard, youtube landscape holds shots longer, an in-feed video sits between. It does NOT set length — the runtime directive does. Set "platform" to the video target.
- "motion" describes CHANGE OVER TIME — what the camera does (push in, pan left, orbit, static hold) and what the subject does. It must NOT restate the composition already in "imagePrompt". A shot whose motion is just its imagePrompt reworded is a failed shot.
- CONSISTENCY IS REQUIRED: begin every "imagePrompt" with one shared style+subject anchor phrase (identical wording), then add what is unique to that shot.
- LANGUAGE SPLIT — get this exactly right. "imagePrompt" and "motion" are ENGLISH because they are fed to image and video models, which perform best in English; the user never reads them. EVERYTHING the user reads — "hook", "cta", every "narration", and every "brief" — is written ENTIRELY in the LANGUAGE specified above. Never mix the two inside one field.
- "narration" is SPOKEN ALOUD, so write it as natural speech, not as an image caption or a written headline. "brief" is one short line telling a human what this shot shows and how it moves, so they can approve the video without reading English prompts.
- Ground everything in the provided product knowledge — invent no features or claims beyond it.
- Output JSON only. No prose, no markdown fences.`;

const campaignStrategist = `OUTPUT CONTRACT (hard rules — these OVERRIDE anything above):
Return ONLY valid JSON of this exact shape:
{
  "slots": [
    { "index": 0, "pillar": "which content pillar this post serves", "angle": "the specific angle for this post", "format": "text|image|carousel|video", "platforms": ["facebook"], "hook": "a scroll-stopping opening line", "rationale": "why this post, here, in the arc", "dayOffset": 0 }
  ]
}
- Produce EXACTLY the number of slots requested (cadence × duration) — no more, no fewer.
- index starts at 0 and increments by 1 in posting order.
- "format" is one of text|image|carousel|video (English enum); choose what best fits the slot's message and platforms.
- "platforms" is a non-empty subset of the campaign's target platforms (English platform ids).
- Rotate the content pillars across slots and move through the funnel arc (awareness → consideration → conversion → retention) over the duration.
- "dayOffset" spreads slots across the duration (0-based day from campaign start) honoring the cadence — do not stack multiple same-platform posts on one day.
- Write "pillar", "angle", "hook", and "rationale" in the LANGUAGE specified above; keep enum values (format, platforms) in English.
- Output JSON only. No prose, no markdown fences.`;

export const AGENT_OUTPUT_CONTRACTS: Record<ContractKey, string> = {
  ideation,
  strategy,
  infographic,
  storyboard,
  storyboard_carousel: storyboardCarousel,
  video_script: videoScript,
  campaign_strategist: campaignStrategist,
};
