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
}

export const masterAgent = new MasterAgent();
