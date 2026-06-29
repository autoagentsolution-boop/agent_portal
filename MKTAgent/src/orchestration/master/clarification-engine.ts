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
// A marketing plan is only as good as its targeting. These three slots most change
// the output; when too few are known the DAG would be generic, so we ask first.
const RICHNESS_THRESHOLD = 2;

// product is the one slot we cannot plan without (concept_writer needs something to
// write about). The richness gate then prevents the OTHER failure mode the M1 panel
// hit: a request with product + a platform jumping straight to a 2-node DAG with zero
// questions ("it's dumb"). When high-impact context (audience / angle / platforms) is
// thin, we promote those questions to required so the agent reasons before planning.
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

  // Richness gate: count the high-impact context we already have. Only engages once a
  // product is known and an output is chosen (otherwise the required questions above
  // are the blockers). When thin, the audience/angle/platforms questions below become
  // required — that is the fix for "jumped straight to the DAG".
  const highImpactFilled =
    (goal.slots.targetAudience ? 1 : 0) +
    (goal.slots.angle ? 1 : 0) +
    (goal.platforms.length > 0 ? 1 : 0);
  const thin =
    Boolean(goal.slots.product) && anyOutput && highImpactFilled < RICHNESS_THRESHOLD;

  // Publishing with no platform named → ask. Required under the richness gate (a
  // multi-platform intent must be explicit before an external write), else optional.
  if (goal.outputs.needsPublishing && goal.platforms.length === 0) {
    q.push({
      slot: 'platforms',
      question: 'Which platforms should this publish to?',
      required: thin,
      choices: ['facebook', 'instagram', 'threads', 'linkedin', 'x'],
      multiSelect: true,
    });
  }

  // Context that materially improves copy quality. Required when the request is thin,
  // optional once enough high-impact slots are already filled.
  if (!goal.slots.targetAudience) {
    q.push({ slot: 'targetAudience', question: 'Who is the target audience?', required: thin });
  }
  if (!goal.slots.angle) {
    q.push({ slot: 'angle', question: 'Any specific angle or key message to emphasize?', required: thin });
  }

  const trimmed = q.slice(0, MAX_QUESTIONS);
  // Proceed when nothing required is outstanding. Optional-only gaps don't block.
  const hasRequired = trimmed.some((x) => x.required);
  return hasRequired
    ? { status: 'needs_clarification', questions: trimmed }
    : { status: 'ready' };
};
