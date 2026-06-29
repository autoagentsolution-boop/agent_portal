// ClarificationEngine (brief §4). Decides whether the GoalSpec has enough to plan,
// or whether to ask the user a few high-impact questions first. Rules (brief §4):
//   - ask at most 5 questions at once
//   - never ask what can be safely inferred (a filled slot is never re-asked)
//   - use multiple-choice for output_format and platforms
// Pure + deterministic so it is unit-testable without an LLM. The LLM is NOT used
// to decide questions — slot presence does.
import { z } from 'zod';
import type { GoalSpec } from '../schemas/goal-spec.ts';

export const clarificationQuestion = z.object({
  slot: z.string(), // which field an answer fills (e.g. "product", "output_format")
  question: z.string(),
  required: z.boolean(),
  // Present for multiple-choice slots (output_format, platforms). UI renders chips.
  choices: z.array(z.string()).optional(),
  multiSelect: z.boolean().optional(),
});
export type ClarificationQuestion = z.infer<typeof clarificationQuestion>;

export type ClarificationResult =
  | { status: 'ready' }
  | { status: 'needs_clarification'; questions: ClarificationQuestion[] };

const MAX_QUESTIONS = 5;

// product is the one slot we cannot plan without (concept_writer needs something to
// write about). Everything else is optional — copy-gen resolves language/voice from
// the campaign/user config layer (T3), and platforms defaults to facebook.
export const evaluateClarification = (goal: GoalSpec): ClarificationResult => {
  const q: ClarificationQuestion[] = [];

  if (!goal.slots.product) {
    q.push({
      slot: 'product',
      question: 'What product, service, or topic is this for?',
      required: true,
    });
  }

  // No output requirement at all → the request is too vague to plan; offer the
  // brief's §4 output_format menu as a required multiple-choice.
  const anyOutput =
    goal.outputs.needsTextPost || goal.outputs.needsInfographic || goal.outputs.needsVideo;
  if (!anyOutput) {
    q.push({
      slot: 'output_format',
      question: 'What do you want to produce?',
      required: true,
      choices: ['Text post only', 'Text + infographic', 'Text + infographic + video', 'Full multi-platform campaign'],
    });
  }

  // Publishing with no platform named → ask (optional; planner defaults to facebook
  // but a multi-platform intent should be explicit before an external write).
  if (goal.outputs.needsPublishing && goal.platforms.length === 0) {
    q.push({
      slot: 'platforms',
      question: 'Which platforms should this publish to?',
      required: false,
      choices: ['facebook', 'instagram', 'threads', 'linkedin', 'x'],
      multiSelect: true,
    });
  }

  // Optional context that materially improves copy quality — asked only if room.
  if (!goal.slots.targetAudience) {
    q.push({ slot: 'targetAudience', question: 'Who is the target audience?', required: false });
  }
  if (!goal.slots.angle) {
    q.push({ slot: 'angle', question: 'Any specific angle or key message to emphasize?', required: false });
  }

  const trimmed = q.slice(0, MAX_QUESTIONS);
  // Proceed when nothing required is outstanding. Optional-only gaps don't block.
  const hasRequired = trimmed.some((x) => x.required);
  return hasRequired
    ? { status: 'needs_clarification', questions: trimmed }
    : { status: 'ready' };
};
