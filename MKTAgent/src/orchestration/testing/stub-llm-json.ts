// Shared DRY-RUN LlmJsonFn stub for verify-* scripts.
//
// This was copy-pasted into five verify scripts, each dispatching on the system prompt and each
// returning the strategy brief as its fallback. Adding `infographic` and `video_script` (2026-07-21)
// broke all five at once — the fallback is a strategy_brief, which no longer satisfies either new
// contract. One copy means the next node added is one edit, not six.
//
// Dispatch is by a distinctive phrase from each agent's registry `promptSections.role`, so a
// contract reword does not silently reroute a stub to the wrong shape.
import type { LlmJsonFn } from '../master/llm-json.ts';

export const stubLlmJson: LlmJsonFn = async (systemPrompt) => {
  if (/ideation/i.test(systemPrompt)) return { ideas: ['Stub idea A', 'Stub idea B'], chosen: 'Stub idea A' };
  if (/infographic/i.test(systemPrompt)) {
    return {
      imagePrompt: 'Stub overview layout: product centre, three labelled benefit blocks',
      visualBrief: 'Stub overview brief',
      onImageText: ['Stub headline'],
      aspectRatio: '1:1',
    };
  }
  if (/scriptwriter/i.test(systemPrompt)) {
    return {
      platform: 'instagram',
      hook: 'Stub hook',
      cta: 'Stub CTA',
      totalDurationSec: 10,
      shots: [
        { index: 0, imagePrompt: 'Stub anchor. hook frame', motion: 'fast push in', narration: 'Stub hook line', durationSec: 4 },
        { index: 1, imagePrompt: 'Stub anchor. payoff frame', motion: 'slow pan right', narration: 'Stub CTA line', durationSec: 6 },
      ],
    };
  }
  if (/storyboard/i.test(systemPrompt)) return { frames: [{ index: 0, imagePrompt: 'Stub frame prompt', caption: 'Stub caption' }] };
  return { positioning: 'Stub positioning', audience: 'Stub audience', pillars: ['p1', 'p2'], funnelStage: 'awareness' };
};
