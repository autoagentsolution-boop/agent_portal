// MasterAgent (brief §1) — the orchestrator. It does NOT write content or publish;
// it analyzes intent, decides whether to clarify, and (when ready) plans the DAG.
// This is the pure planning brain; persistence (Phase 3) + execution (Phase 4) sit
// around it. Returns a discriminated outcome so the API layer maps cleanly to a
// WorkflowRun status (planning result → awaiting_clarification | planned).
import type { GoalSpec } from '../schemas/goal-spec.ts';
import type { WorkflowPlan } from '../schemas/workflow-plan.ts';
import { requirementAnalyzer, type RequirementAnalyzer } from './requirement-analyzer.ts';
import { evaluateClarification, type ClarificationQuestion } from './clarification-engine.ts';
import { planWorkflow } from './workflow-planner.ts';
import { mergeGoals, applyRemovals } from './goal-merge.ts';

export type MasterAgentOutcome =
  | { status: 'awaiting_clarification'; goal: GoalSpec; questions: ClarificationQuestion[] }
  | { status: 'planned'; goal: GoalSpec; plan: WorkflowPlan }
  | { status: 'plan_error'; goal: GoalSpec; error: string; detail?: string[] };

export class MasterAgent {
  constructor(private analyzer: RequirementAnalyzer = requirementAnalyzer) {}

  // Plan from an already-extracted GoalSpec (used after clarification answers are
  // merged in by the API layer — no re-analysis needed).
  planFromGoal(goal: GoalSpec): MasterAgentOutcome {
    const clarify = evaluateClarification(goal);
    if (clarify.status === 'needs_clarification') {
      return { status: 'awaiting_clarification', goal, questions: clarify.questions };
    }
    const planned = planWorkflow(goal);
    if (!planned.ok) {
      return { status: 'plan_error', goal, error: planned.error, detail: planned.detail };
    }
    return { status: 'planned', goal, plan: planned.plan };
  }

  // Full pass from a raw message.
  async handle(message: string): Promise<MasterAgentOutcome> {
    const goal = await this.analyzer.analyze(message);
    return this.planFromGoal(goal);
  }

  // Conversational refinement: the user follows up on an existing run with a new
  // free-text message ("…and add an image"). Analyze the message as a DELTA and
  // merge it additively onto the prior goal so nothing already gathered is lost,
  // then re-plan. This is what keeps the conversation cumulative instead of each
  // turn re-asking everything.
  async refine(prior: GoalSpec, message: string): Promise<MasterAgentOutcome> {
    const { goal: delta, removals } = await this.analyzer.analyzeWithRemovals(message);
    // Additive merge first (keep everything gathered + add new), THEN subtract any
    // removals the turn expressed ("bỏ video"). Order matters: a turn that both adds
    // and removes resolves to add-then-remove.
    const merged = applyRemovals(mergeGoals(prior, delta), removals);
    return this.planFromGoal(merged);
  }
}

export const masterAgent = new MasterAgent();
