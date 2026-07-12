// Atria autonomous-approval policy (autonomy-hardening Phase 01).
//
// Model = per-flow GRANT, not a standing policy. When a run's approvalMode is 'atria', the
// user already double-confirmed this SPECIFIC flow up front (grant endpoint), so the flow is
// authorized to run end-to-end with no mid-flow UI click. This function's ONLY job at each
// gate is to verify the GUARDRAILS still hold — it never independently decides to publish,
// because the human already did, for the whole flow.
//
// Fail-closed: anything unproven → 'hold'. A 'hold' does NOT fail the run; the executor parks
// the node (needs human) + notifies. Only a passing guardrail set → 'approve' (clear the gate).
//
// Pure + deterministic → unit-verifiable without a DB or network (approval-policy.verify.ts).
import type { AgentDefinition } from '../registry/agent-types.ts';

export type GateKind = NonNullable<AgentDefinition['gate']>; // 'selection' | 'cost' | 'publish'
export type ApprovalDecision = 'approve' | 'hold';

// Everything the policy needs to judge a gate, computed by the executor at the boundary.
// Keeping it explicit (vs. reaching into DB rows) is what makes the policy pure + testable.
export interface GuardrailContext {
  // Every target platform is connected/resolved (the /execute connection gate passed).
  connected: boolean;
  // The required media asset is present on the post (re-read at the boundary in Phase 02).
  mediaReady: boolean;
  // Every target platform's adapter supports the asset type it would publish (no silent skip).
  cleanlyPostable: boolean;
  // Est. remaining spend this gate would authorize (e.g. the Veo video clip cost).
  estCostUsd: number;
  // Autonomy spend ceiling. null = not configured → fail-closed (never waive a cost gate).
  budgetUsd: number | null;
  // Produced content passed its checks (e.g. a concept artifact exists / copy generated).
  contentChecksPass: boolean;
}

// Decide whether a granted (atria-mode) run may clear THIS gate autonomously.
export const atriaApprovalPolicy = (gate: GateKind, ctx: GuardrailContext): ApprovalDecision => {
  switch (gate) {
    case 'selection':
      // No external risk (no spend, no publish) — just auto-selecting a produced version.
      // Only guardrail: the content actually got produced.
      return ctx.contentChecksPass ? 'approve' : 'hold';

    case 'cost':
      // Waive an expensive step ONLY when its spend is under the configured ceiling.
      // Unknown ceiling → hold (never blind-spend on the user's behalf).
      if (ctx.budgetUsd === null) return 'hold';
      return ctx.estCostUsd <= ctx.budgetUsd ? 'approve' : 'hold';

    case 'publish':
      // Highest-risk gate (a real external write). EVERY guardrail must hold, else park + notify.
      return ctx.connected && ctx.mediaReady && ctx.cleanlyPostable && ctx.contentChecksPass
        ? 'approve'
        : 'hold';

    case 'schedule':
      // A schedule is NEVER auto-cleared, even for a granted run: parse ambiguity + sender-vs-recipient
      // timezone mean the exact instant MUST be confirmed by a human before the run is parked (the single
      // mitigation that covers both risks). Always hold → the executor halts for the explicit time-confirm.
      return 'hold';
  }
};

// One-line human-readable reason a publish/cost gate was HELD, for the notify notice + audit.
// Returns null when nothing is blocking (guardrails all pass).
export const guardrailHoldReason = (gate: GateKind, ctx: GuardrailContext): string | null => {
  if (atriaApprovalPolicy(gate, ctx) === 'approve') return null;
  switch (gate) {
    case 'selection':
      return 'content not produced';
    case 'cost':
      return ctx.budgetUsd === null
        ? 'no autonomy budget configured'
        : `estimated $${ctx.estCostUsd.toFixed(4)} exceeds budget $${ctx.budgetUsd.toFixed(4)}`;
    case 'publish': {
      const gaps: string[] = [];
      if (!ctx.connected) gaps.push('platform not connected');
      if (!ctx.mediaReady) gaps.push('media not ready');
      if (!ctx.cleanlyPostable) gaps.push('asset unsupported on a target');
      if (!ctx.contentChecksPass) gaps.push('content checks failed');
      return gaps.join('; ') || 'guardrail not met';
    }
    case 'schedule':
      return 'awaiting your confirmation of the exact time';
  }
};
