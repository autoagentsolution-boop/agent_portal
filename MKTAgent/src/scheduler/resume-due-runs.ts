// Generic resume-due-runs tick (generic-scheduler node, 2026-07-12). The single TYPE-AGNOSTIC driver:
// every minute it finds ONE run whose confirmed schedule is due and RE-ENTERS the executor at that run's
// pre-authorized terminal action. It knows nothing about email/publish — it just resumes runs.
//
// Two guards stop a double-fire, exactly like the publish tick: a DEDICATED advisory lock serializes
// overlapping ticks/instances, and claimScheduledDue's atomic `scheduled → running` updateMany guards the
// row even if the lock were ever bypassed. Catch-up is native: the query is `scheduledResumeAt <= now`, so
// a window missed during downtime fires late on the next tick, never lost.
//
// Re-entry is native to the resume-safe executor: runWorkflow skips the already-completed writer +
// scheduler nodes and, because we pass approveNodeId = the action node, WAIVES that single downstream
// gate (the human already approved the draft + time at the schedule gate) so the action runs unattended.
// A run that errors on resume is set `failed` by runWorkflow (NOT back to `scheduled`) → no infinite loop.
import { acquireAdvisoryLock } from './lock.ts';
import { claimScheduledDue } from '../db/repos/workflow-run-repo.ts';
import { runWorkflow, type ExecuteOptions } from '../orchestration/executor/workflow-executor.ts';
import { goalSpec } from '../orchestration/schemas/goal-spec.ts';
import { workflowPlan } from '../orchestration/schemas/workflow-plan.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';

// Distinct lock key from the publish tick (`mkt-post-scheduler`) so the two crons never block each other.
const RESUME_LOCK_KEY = 'mkt-scheduler-resume';

export interface ResumeTickResult {
  picked: boolean;
  runId?: string;
  status?: string;
  reason?: string;
}

// One pass: claim one due run and re-enter its flow at the pre-authorized action. `opts` threads DRY-RUN
// seams (stubbed gmail/publish) for verification; production passes none (real send/publish).
export async function runResumeDueTick(opts: ExecuteOptions = {}): Promise<ResumeTickResult> {
  const lock = await acquireAdvisoryLock(RESUME_LOCK_KEY);
  if (!lock.acquired) return { picked: false, reason: 'lock_held' };
  try {
    const run = await claimScheduledDue(new Date());
    if (!run) return { picked: false, reason: 'no_due' };

    const goal = goalSpec.parse(run.goal);
    const plan = workflowPlan.parse(run.plan);
    // The pre-authorized action = the node immediately downstream of the scheduler (writer → scheduler →
    // action). Passing its id as approveNodeId waives ITS gate only (scoped, this run, this re-entry).
    const schedulerNode = plan.nodes.find((n) => n.agentId === 'scheduler');
    const actionNode = schedulerNode ? plan.nodes.find((n) => n.dependsOn.includes(schedulerNode.nodeId)) : undefined;
    if (!actionNode) {
      // A scheduled run with no downstream action is malformed — fail it rather than loop forever.
      logger.error('resume_tick_no_action_node', { runId: run.id });
      await logRun('error', 'wf_resume', { runId: run.id, error: 'no_action_node' }, run.ownerId).catch(() => {});
      return { picked: true, runId: run.id, status: 'failed', reason: 'no_action_node' };
    }

    const outcome = await runWorkflow(run.id, run.ownerId, goal, plan, { ...opts, approveNodeId: actionNode.nodeId });
    logger.info('resume_tick', { runId: run.id, action: actionNode.agentId, status: outcome.status });
    await logRun(outcome.status === 'failed' ? 'error' : 'info', 'wf_resume', { runId: run.id, action: actionNode.agentId, status: outcome.status }, run.ownerId).catch(() => {});
    return { picked: true, runId: run.id, status: outcome.status };
  } catch (e) {
    logger.error('resume_tick_failed', { error: String(e).slice(0, 300) });
    return { picked: false, reason: 'error' };
  } finally {
    await lock.release();
  }
}
