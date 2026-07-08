// Atria suggestion engine (Phase 06) — the WOW: deterministic rules map behavioral signals to a
// ranked list of proactive suggestions, each with a SHOWN rationale (the trust story) and a
// prefilled action. Pure (signals → suggestions); NOTHING runs from here — the user must accept +
// grant. No ML, no embeddings — explainable rules only, so a nudge is always defensible.
import type { AtriaSignals } from './signal-reader.ts';
import { getRoadmapAgent } from '../registry/roadmap-agents.ts';

export type SuggestionKind = 'plan_campaign' | 'repeat_winner' | 'roadmap_email' | 'roadmap_memory';

export interface Suggestion {
  kind: SuggestionKind;
  headline: string;
  rationale: string;
  rank: number; // higher = surfaced first
  // What accepting prefills: a campaign-plan intent (→ Phase 03 flow) OR a roadmap pitch to log.
  prefill: {
    intent?: string;
    product?: string;
    roadmapAgentId?: string;
  };
}

// Thresholds — named so the rules stay explainable + tunable (no magic numbers).
const ONE_OFF_MIN = 3; // ≥3 one-off posts for one product → suggest a real campaign
const LEADS_MIN = 5; // ≥5 captured leads with no email capability → pitch Email
const LEAD_SPIKE_MIN = 3; // ≥3 leads on ONE product (no campaign yet) → ride it with a campaign
const EDIT_RATIO_MIN = 0.5; // ≥50% of posts hand-edited → pitch Memory
const EDIT_COUNT_MIN = 3; // …and at least 3 edits, so a tiny sample doesn't trigger it

export function suggestFor(signals: AtriaSignals): Suggestion[] {
  const out: Suggestion[] = [];

  // R1 — piecemeal posting about one product, no campaign for it yet → plan a month.
  if (signals.oneOffTopProduct && signals.oneOffTopProductCount >= ONE_OFF_MIN && !signals.hasActiveCampaignForTopProduct) {
    out.push({
      kind: 'plan_campaign',
      headline: `Plan a full month for ${signals.oneOffTopProduct}?`,
      rationale: `You've made ${signals.oneOffTopProductCount} one-off posts about ${signals.oneOffTopProduct} but never run a full campaign for it. A planned month keeps the message consistent and saves you setting up each post by hand.`,
      rank: 100,
      prefill: { intent: `Plan a month of content for ${signals.oneOffTopProduct}`, product: signals.oneOffTopProduct },
    });
  }

  // R1b — leads are spiking on ONE product with no campaign yet → ride the demand with a campaign.
  // Ranked just under R1 (piecemeal posting) but above "repeat what worked": a live lead signal is
  // the strongest "act now" cue Atria has today.
  if (signals.leadTopProduct && signals.leadTopProductCount >= LEAD_SPIKE_MIN) {
    out.push({
      kind: 'plan_campaign',
      headline: `${signals.leadTopProductCount} leads on ${signals.leadTopProduct} — plan a campaign?`,
      rationale: `${signals.leadTopProduct} has pulled in ${signals.leadTopProductCount} leads but has no campaign running. A planned month while interest is hot compounds the momentum instead of letting it cool.`,
      rank: 90,
      prefill: { intent: `Plan a month of content for ${signals.leadTopProduct}`, product: signals.leadTopProduct },
    });
  }

  // R2 — a campaign fully posted → repeat what worked (Phase 07 impact enriches the rationale).
  if (signals.completedCampaignCount >= 1) {
    out.push({
      kind: 'repeat_winner',
      headline: 'Repeat what worked?',
      rationale: `You've completed ${signals.completedCampaignCount} full campaign${signals.completedCampaignCount > 1 ? 's' : ''}. I can plan the next month building on the pillars that performed best.`,
      rank: 80,
      prefill: { intent: 'Plan a follow-up month building on my last campaign' },
    });
  }

  // R3 — leads captured but no way to nurture them → pitch the Email roadmap agent.
  if (signals.leadCount >= LEADS_MIN) {
    const email = getRoadmapAgent('email')!;
    out.push({
      kind: 'roadmap_email',
      headline: `Nurture your ${signals.leadCount} leads automatically?`,
      rationale: `You've captured ${signals.leadCount} leads but there's no email follow-up yet. ${email.whatItWouldDo}`,
      rank: 70,
      prefill: { roadmapAgentId: 'email' },
    });
  }

  // R4 — you keep rewriting the copy → pitch the Memory agent (the "learn my style" answer).
  if (signals.editedPostRatio >= EDIT_RATIO_MIN && signals.editedPostCount >= EDIT_COUNT_MIN) {
    const memory = getRoadmapAgent('memory')!;
    out.push({
      kind: 'roadmap_memory',
      headline: 'Want me to remember your style?',
      rationale: `You've hand-edited ${signals.editedPostCount} of your posts. ${memory.whatItWouldDo}`,
      rank: 60,
      prefill: { roadmapAgentId: 'memory' },
    });
  }

  return out.sort((a, b) => b.rank - a.rank);
}
