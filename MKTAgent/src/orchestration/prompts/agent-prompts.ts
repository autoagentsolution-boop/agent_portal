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

export type ContractKey = 'ideation' | 'strategy' | 'storyboard' | 'storyboard_carousel' | 'campaign_strategist';

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
  storyboard,
  storyboard_carousel: storyboardCarousel,
  campaign_strategist: campaignStrategist,
};
