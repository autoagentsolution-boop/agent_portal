// Self-healing reaper (autonomy-hardening Phase 04 / C3). An always-on fleet needs to recover
// rows left in a transient state by a crash/redeploy — nothing else does. Every 5 min it sweeps:
//   • posts stuck `posting`  → `error` (editable/deletable/re-runnable again)
//   • nodes stuck `running`  → `failed` (video-aware budget) + cascade the run → `failed`
//   • runs  stuck `running`  → `failed` (+ any still-running node failed)
//   • runs orphaned at needs_approval/planned past a long TTL → surfaced (logged), NOT deleted
// Idempotent + best-effort: every write is guarded on the stuck state (a concurrent legit
// transition wins), and one row's failure never aborts the sweep. Owner-agnostic worker path.
import {
  findStaleRunningRuns, findStaleRunningNodes, findOrphanedRuns, reapRunToFailed, reapNodeToFailed,
} from '../db/repos/workflow-run-repo.ts';
import { findStalePostingPosts, reapPostingToError } from '../db/repos/post-repo.ts';
import { publishPostStatus, publishNodeStatus } from '../events/bus.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { env } from '../config/env.ts';

const minsAgo = (now: Date, min: number): Date => new Date(now.getTime() - min * 60_000);

export interface ReaperResult { postingReaped: number; nodesReaped: number; runsReaped: number; orphansFound: number }

// One reaper pass. `now` injectable for deterministic verification.
export const runReaperOnce = async (now: Date = new Date()): Promise<ReaperResult> => {
  const result: ReaperResult = { postingReaped: 0, nodesReaped: 0, runsReaped: 0, orphansFound: 0 };

  // 1) Stuck `posting` posts → error. Now actionable (edit/delete/re-run).
  for (const post of await findStalePostingPosts(minsAgo(now, env.REAPER_POSTING_TIMEOUT_MIN))) {
    try {
      const reaped = await reapPostingToError(post.id, 'publish timed out or was interrupted (reaper)');
      if (!reaped) continue;
      result.postingReaped++;
      publishPostStatus(post.ownerId, { postId: post.id, status: 'error', campaignId: post.campaignId, error: reaped.error });
      await logRun('warn', 'reaper_post', { id: post.id, from: 'posting', to: 'error' }, post.ownerId);
    } catch (e) {
      logger.error('reaper_post_failed', { postId: post.id, error: String(e).slice(0, 160) });
    }
  }

  // 2) Stuck `running` nodes → failed (video gets a bigger budget) + cascade the run → failed. A
  //    node left running blocks the scheduler (isPublishBlocked) forever — the 321f253c class.
  const nodeCandidates = await findStaleRunningNodes(minsAgo(now, env.REAPER_NODE_TIMEOUT_MIN));
  for (const node of nodeCandidates) {
    // Per-agent budget: a Veo render is minutes × N clips — don't false-reap it at the short timeout.
    const budgetMin = node.agentId === 'video' ? env.REAPER_VIDEO_NODE_TIMEOUT_MIN : env.REAPER_NODE_TIMEOUT_MIN;
    if (node.startedAt && node.startedAt.getTime() > minsAgo(now, budgetMin).getTime()) continue; // within budget
    try {
      const reaped = await reapNodeToFailed(node.id, `node timed out (reaper): ${node.agentId} exceeded ${budgetMin}m`);
      if (!reaped) continue;
      result.nodesReaped++;
      publishNodeStatus(node.ownerId, { runId: node.runId, nodeId: node.nodeId, agentId: node.agentId, status: 'failed', error: 'reaper: node timed out' });
      if (await reapRunToFailed(node.runId)) result.runsReaped++;
      await logRun('warn', 'reaper_node', { runId: node.runId, nodeId: node.nodeId, agentId: node.agentId, budgetMin }, node.ownerId);
    } catch (e) {
      logger.error('reaper_node_failed', { nodeId: node.id, error: String(e).slice(0, 160) });
    }
  }

  // 3) Stuck `running` runs (no running node OR the crash was between nodes) → failed. Guarded on
  //    `running`, so a run just reaped via its node in step 2 is already `failed` → no double count.
  for (const run of await findStaleRunningRuns(minsAgo(now, env.REAPER_RUN_TIMEOUT_MIN))) {
    try {
      if (await reapRunToFailed(run.id)) {
        result.runsReaped++;
        await logRun('warn', 'reaper_run', { runId: run.id, from: 'running', to: 'failed' }, run.ownerId);
      }
    } catch (e) {
      logger.error('reaper_run_failed', { runId: run.id, error: String(e).slice(0, 160) });
    }
  }

  // 4) Orphaned parked runs past a long TTL → surface ONLY (the user may still act; never auto-
  //    delete). One SUMMARY line per sweep (not per-row) — the same orphans reappear every 5 min, so
  //    per-row logging would spam. Ops sees the count + a sample of ids to investigate/clean up.
  const orphans = await findOrphanedRuns(new Date(now.getTime() - env.REAPER_ORPHAN_TTL_DAYS * 86_400_000));
  result.orphansFound = orphans.length;
  if (orphans.length > 0) {
    logger.warn('reaper_orphans_found', { count: orphans.length, ttlDays: env.REAPER_ORPHAN_TTL_DAYS, sampleIds: orphans.slice(0, 10).map((r) => r.id) });
  }

  if (result.postingReaped || result.nodesReaped || result.runsReaped || result.orphansFound) {
    logger.info('reaper_swept', { ...result });
  }
  return result;
};
