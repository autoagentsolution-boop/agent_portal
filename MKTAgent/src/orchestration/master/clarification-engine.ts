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

// Placeholder product strings that pass `!product` but carry no real knowledge. The
// root bug: "sản phẩm của tôi" satisfied the old gate. Exact-match (anchored ^…$) so a
// genuine answer that merely starts with "sản phẩm" (e.g. "sản phẩm dưỡng da ABC…", which
// the analyzer anyway strips to "dưỡng da ABC…") isn't wrongly flagged.
const PLACEHOLDER_PRODUCT =
  /^(sản phẩm|san pham|dịch vụ|dich vu|sản phẩm của (tôi|mình)|san pham cua (toi|minh)|dịch vụ của (tôi|mình)|my product|the product|product|my service|service)$/i;

// A dangling possessive — the analyzer's `sentenceAfter` grabbed only the words AFTER
// "sản phẩm" so a "...sản phẩm của tôi trên facebook" message yields a product like
// "của tôi trên facebook": noise, not a product name. Start-anchored on the possessive.
const DANGLING_POSSESSIVE = /^của\s+(tôi|mình|chúng tôi|chung toi|toi|minh)\b/i;

// Knowledge gate: the product is "thin" when we have nothing concrete to build copy or
// an image from — productDetails empty AND the product string is itself empty, a
// placeholder, a dangling possessive, or too short to describe anything. A rich
// productDetails (≥12 chars) or a descriptive product name clears it, so a real
// description is never re-asked.
const isThinProduct = (product?: string | null, productDetails?: string | null): boolean => {
  if (productDetails && productDetails.trim().length >= 12) return false;
  const p = (product ?? '').trim();
  return !p || PLACEHOLDER_PRODUCT.test(p) || DANGLING_POSSESSIVE.test(p) || p.length < 12;
};

// product is the one slot we cannot plan without (concept_writer needs something to
// write about). The richness gate then prevents the OTHER failure mode the M1 panel
// hit: a request with product + a platform jumping straight to a 2-node DAG with zero
// questions ("it's dumb"). When high-impact context (audience / angle / platforms) is
// thin, we promote those questions to required so the agent reasons before planning.
// Slots a request genuinely CANNOT be planned without — the only ones that still block an
// autonomous (granted) run. Everything else (audience, angle, accountType, platform richness)
// is inferred/defaulted rather than dead-ending the flow at awaiting_clarification.
const AUTONOMY_HARD_SLOTS = new Set(['product', 'productDetails', 'output_format']);

// autonomous=true (Atria granted path): proceed on inferred slots instead of emitting the
// optional-ish required questions a human would answer. Only AUTONOMY_HARD_SLOTS still block —
// Atria can't invent a product or an output format. The inferred defaults are logged by the
// caller for audit. Default false → human behavior is byte-identical.
export const evaluateClarification = (
  goal: GoalSpec,
  opts: { autonomous?: boolean } = {},
): ClarificationResult => {
  const q: ClarificationQuestion[] = [];

  // A PERSONAL post shares an experience/topic, not a product. When the account is personal
  // and a topic/angle is given, THAT is the subject — so we don't loop forever asking for a
  // "product" the user will never have (the never-ending clarification bug).
  const personalTopic = goal.slots.accountType === 'personal' && Boolean((goal.slots.angle ?? '').trim());
  const thinProduct = !personalTopic && isThinProduct(goal.slots.product, goal.slots.productDetails);

  if (!goal.slots.product && !personalTopic) {
    q.push({
      slot: 'product',
      question: 'What product, service, or topic is this for?',
      required: true,
    });
  } else if (thinProduct) {
    // We have a name but no substance ("sản phẩm của tôi") → ask for the real product
    // knowledge. Required: the agent must reason about the product before planning
    // (the "ask hard, never reject" rule). The conversation author voices it in the
    // user's own language regardless of the literal text here.
    q.push({
      slot: 'productDetails',
      // Language-NEUTRAL seed (P2-5): when GEMINI_API_KEY is absent the conversation author can't
      // translate, so a VN literal would leak to a non-VN user. English is the safer fallback; the
      // LLM path still voices it in the user's own language.
      question: 'What is your product or service — what does it do, who is it for, and what makes it different?',
      required: true,
    });
  }

  // Product Expert (Atria Phase 02) — "ask-until-enough" depth probe. isThinProduct clears at
  // productDetails ≥12 chars, but 12 chars ("skincare serum ABC") is a name, not knowledge the
  // agents can build specific copy/images from. When we have SOME substance but it's still brief
  // (12–40 chars), ask ONE more targeted round for the differentiator / audience-fit / proof.
  // BOUNDED, so it cannot loop: mergeGoals ACCUMULATES productDetails (append, not fillIfEmpty), so
  // each answer grows it past the 40-char bar and the probe stops. Kept SEPARATE from isThinProduct
  // so the tuned accountType/audience/
  // angle required-ness (which keys off thinProduct) is unchanged — this only raises the product
  // substance bar, the one gap the tuned gates left open.
  const productDetailsLen = (goal.slots.productDetails ?? '').trim().length;
  if (!thinProduct && !personalTopic && Boolean(goal.slots.product) && productDetailsLen > 0 && productDetailsLen < 40) {
    q.push({
      slot: 'productDetails',
      question: 'Tell me a bit more so the content is specific: what makes it different, who is it for, and any proof or results?',
      required: true,
    });
  }

  // No output requirement at all → the request is too vague to plan; offer the
  // brief's §4 output_format menu as a required multiple-choice.
  const anyOutput =
    goal.outputs.needsTextPost || goal.outputs.needsInfographic ||
    goal.outputs.needsStoryboard || goal.outputs.needsVideo;
  if (!anyOutput) {
    q.push({
      slot: 'output_format',
      question: 'What do you want to produce?',
      required: true,
      choices: ['Text post only', 'Text + infographic', 'Text + carousel', 'Text + video', 'Full multi-platform campaign'],
    });
  }

  // Richness gate: count the high-impact context we already have. Only engages once a
  // product is known and an output is chosen (otherwise the required questions above
  // are the blockers). When thin, the audience/angle/platforms questions below become
  // required — that is the fix for "jumped straight to the DAG". productDetails counts
  // as high-impact context: real product knowledge is the strongest signal of a
  // plannable request.
  const highImpactFilled =
    (goal.slots.productDetails ? 1 : 0) +
    (goal.slots.targetAudience ? 1 : 0) +
    (goal.slots.angle ? 1 : 0) +
    (goal.platforms.length > 0 ? 1 : 0);
  const thin =
    Boolean(goal.slots.product) && anyOutput && highImpactFilled < RICHNESS_THRESHOLD;

  // Publishing with no platform named → ALWAYS ask (mandatory brief field). We must never
  // silently default the publish targets (the "defaulted to Facebook" bug): the user has to
  // choose where this goes before an external write.
  if (goal.outputs.needsPublishing && goal.platforms.length === 0) {
    q.push({
      slot: 'platforms',
      question: 'Which platforms should this publish to?',
      required: true,
      choices: ['facebook', 'instagram', 'threads', 'linkedin', 'x'],
      multiSelect: true,
    });
  }

  // Who is marketing — sets scope, voice, and the compliance note. Required only when
  // the product is thin (then the agent is already reasoning hard before planning);
  // otherwise high-impact-but-optional, like audience/angle, so a rich request isn't
  // gated on it. Multiple-choice so the answer maps cleanly to the accountType enum.
  if (!goal.slots.accountType) {
    q.push({
      slot: 'accountType',
      // Neutral seed (P2-5) — English fallback; the LLM path translates. Choices stay as-is: they map
      // to the accountType enum via parseAccountType, which is tuned for both VN and EN answers.
      question: 'Who are you marketing as — an individual, a brand/shop, or a company?',
      required: thinProduct,
      choices: ['cá nhân', 'thương hiệu', 'công ty'],
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

  // Autonomy bypass: keep only the hard-blocking questions as required; the rest proceed on
  // inferred defaults so a granted run doesn't dead-end on optional-ish gaps.
  const effective = opts.autonomous
    ? q.map((x) => (x.required && !AUTONOMY_HARD_SLOTS.has(x.slot) ? { ...x, required: false } : x))
    : q;

  const trimmed = effective.slice(0, MAX_QUESTIONS);
  // Proceed when nothing required is outstanding. Optional-only gaps don't block.
  const hasRequired = trimmed.some((x) => x.required);
  return hasRequired
    ? { status: 'needs_clarification', questions: trimmed }
    : { status: 'ready' };
};
