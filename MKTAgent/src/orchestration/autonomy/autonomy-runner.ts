// Autonomy kickoff runner (Phase 04). Granting autonomy on a run authorizes it to execute end-to-end
// with no human gate — but nothing STARTED it: the run stayed `planned`, its posts `brief`, and the
// scheduler only publishes `ready` posts. This claims granted-but-unstarted runs and executes them
// through the SAME gated executor. In atria mode the approval policy machine-approves each gate when
// the guardrails hold (a gap parks + notifies — never blind-publishes), so fail-closed is preserved.
//
// Publishing is forced DRY-RUN on this path (demo decision 2026-07-08 "tự chạy nhưng DRY"): the
// autonomous loop runs to completion but writes to no real platform. Flag-gated + atomic-claim-guarded
// so overlapping ticks can't double-execute a run.
import { claimNextGrantedRun, setRunStatus } from '../../db/repos/workflow-run-repo.ts';
import { runWorkflow } from '../executor/workflow-executor.ts';
import { resolveConnections } from '../../connectors/runtime/connection-resolver.ts';
import { goalSpec } from '../schemas/goal-spec.ts';
import { workflowPlan } from '../schemas/workflow-plan.ts';
import type { PublishFn } from '../../scheduler/tick.ts';
import { logRun } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';
import { env } from '../../config/env.ts';

// DRY publish seam: the autonomous loop reaches the publisher and "posts", but no external write
// happens — a simulated ok result keeps the run flowing to `posted` for the demo.
const dryAutonomyPublish: PublishFn = async (platform, input) => ({
  platform,
  ok: true,
  url: `https://dry-run.atria/${platform}/${input.postId}`,
  error: null,
});

export interface AutonomyResult { claimed: number; executed: number; parked: number; failed: number }

// One sweep. Claims up to `maxPerTick` granted runs and executes each (DRY publish). A run whose
// platforms aren't connected parks at `needs_connection` (same fail-closed gate as manual /execute).
export const runAutonomyOnce = async (maxPerTick = env.AUTONOMY_MAX_PER_TICK): Promise<AutonomyResult> => {
  const result: AutonomyResult = { claimed: 0, executed: 0, parked: 0, failed: 0 };
  for (let i = 0; i < maxPerTick; i++) {
    const run = await claimNextGrantedRun(); // atomic → 'running'; null when nothing claimable
    if (!run) break;
    result.claimed++;
    try {
      const goal = goalSpec.parse(run.goal);
      const plan = workflowPlan.parse(run.plan);
      // Connection gate ($0 before any spend): a granted run still needs its targets connected.
      const resolution = await resolveConnections(run.ownerId, goal, plan);
      if (resolution.status !== 'resolved') {
        await setRunStatus(run.id, 'needs_connection');
        result.parked++;
        await logRun('info', 'autonomy_parked_needs_connection', { runId: run.id, count: resolution.required.length }, run.ownerId);
        continue;
      }
      await logRun('info', 'autonomy_kickoff', { runId: run.id }, run.ownerId);
      // Already claimed to `running`. autoPublish:FALSE → run the pre-steps and PARK before the
      // publisher (needs_approval) so the user reviews + applies tone, then approves → the scheduler
      // publishes for real at scheduledAt. Nothing goes on the wire from here; the DRY publishFn is a
      // belt-and-suspenders no-op that is never reached while we park pre-publish.
      await runWorkflow(run.id, run.ownerId, goal, plan, { autoPublish: false, publishFn: dryAutonomyPublish });
      result.executed++;
    } catch (e) {
      await setRunStatus(run.id, 'failed').catch(() => {});
      result.failed++;
      logger.error('autonomy_run_failed', { runId: run.id, error: String(e).slice(0, 200) });
    }
  }
  if (result.claimed) logger.info('autonomy_swept', { ...result });
  return result;
};
