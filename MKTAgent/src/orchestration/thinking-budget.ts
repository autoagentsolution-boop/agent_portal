// Per-agent-group thinking-budget policy (Phase 06). ONE place mapping a registry agentId to the
// gemini-2.5 `thinkingConfig.thinkingBudget` ceiling for its LLM call, so tuning is a single edit.
//
// WHY a budget at all: gemini-2.5-flash's DEFAULT (dynamic) thinking misbehaves WITH tools — it
// intermittently returns finishReason=STOP with EMPTY parts (read as a failed turn → spurious apology).
// An explicit budget fixes that. The budget is a CEILING: the model self-limits below it, so a generous
// ceiling is ~free on easy turns and only spends on hard ones. Runners attach NO tools, so they never hit
// the empty-bug — for them the budget is purely a quality/cost lever.
import type { GoalSpec } from './schemas/goal-spec.ts';

// Brain (atria-brain `doCall`) — reasoning tier, tool-using. Exported so the brain reads the same constant.
export const BRAIN_THINKING_BUDGET = 4096;

// Tier ceilings. Fixed-generous now (finetune later); named constants so the map reads as policy, not magic.
const REASONING = 4096; // ideation, strategy, content_search, campaign_strategist (+ brain)
const CREATIVE: Record<GoalSpec['qualityPref'], number> = { economy: 2048, standard: 4096, high: 8192 };
const SUMMARIZE_MIN = 2048;
const SUMMARIZE_MAX = 8192;
const ACTION = 0; // publisher, email_agent, scheduler — barely touch the text LLM

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

// Creative tier scales by the user-stated quality preference (captured conversationally by the analyzer).
const creativeBudget = (pref?: GoalSpec['qualityPref']): number => CREATIVE[pref ?? 'standard'];

// summarize scales by source length: a longer document earns more room to reason over it (+512 per 500 chars).
const summarizeBudget = (sourceText?: string | null): number =>
  clamp(SUMMARIZE_MIN + Math.floor((sourceText?.length ?? 0) / 500) * 512, SUMMARIZE_MIN, SUMMARIZE_MAX);

// Only the fields the policy reads — decouples from the full RunnerContext (avoids an import cycle).
export interface ThinkingBudgetCtx {
  goal?: Pick<GoalSpec, 'qualityPref' | 'slots'>;
}

// Resolve the ceiling for a node's LLM call. Unlisted agents → REASONING (a safe, self-limiting default).
export const thinkingBudgetFor = (agentId: string, ctx?: ThinkingBudgetCtx): number => {
  switch (agentId) {
    case 'ideation':
    case 'strategy':
    case 'content_search':
    case 'campaign_strategist':
      return REASONING;
    case 'concept_writer':
    case 'email_writer':
      return creativeBudget(ctx?.goal?.qualityPref);
    case 'summarize':
      return summarizeBudget(ctx?.goal?.slots?.sourceText);
    case 'publisher':
    case 'email_agent':
    case 'scheduler':
      return ACTION;
    default:
      return REASONING;
  }
};
