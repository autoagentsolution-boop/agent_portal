// Campaign grant helpers (Atria Phase 05) — the whole-calendar cost estimate shown at the grant
// handshake, and the campaign status rollup the command view renders. Pure aggregation over the
// materialized posts' runs; the bulk grant itself lives in workflow-run-repo (grantAutonomyForCampaign).
import { estimateAgents } from '../../cost/plan-estimate.ts';
import { agentCostAverages, getCampaignRunPlans } from '../../db/repos/workflow-run-repo.ts';

export interface CampaignCostEstimate {
  posts: number;
  agentCount: number;
  totalTokens: number;
  costUsd: number;
  credits: number;
}

// Estimate the whole calendar's spend from each post's registry-composed plan + the owner's real
// per-agent history (with fallbacks). Sum of per-post estimates — what the user sees before granting.
export async function estimateCampaignCost(campaignId: string, ownerId: string): Promise<CampaignCostEstimate> {
  const [plans, history] = await Promise.all([
    getCampaignRunPlans(campaignId, ownerId),
    agentCostAverages(ownerId),
  ]);
  let totalTokens = 0, costUsd = 0, credits = 0, agentCount = 0;
  for (const p of plans) {
    const e = estimateAgents(p.agentIds, history);
    totalTokens += e.totalTokens;
    costUsd += e.costUsd;
    credits += e.credits;
    agentCount += e.agentCount;
  }
  return { posts: plans.length, agentCount, totalTokens, costUsd, credits };
}

export type DerivedPostStatus = 'planned' | 'running' | 'held' | 'posted' | 'failed';

// Collapse (post.status, run.status) into ONE dot value for the command board. `held` = the post
// needs the user (parked at a gate / connection needed); `running` = actively producing/posting.
const derive = (postStatus: string, runStatus: string): DerivedPostStatus => {
  if (postStatus === 'posted' || postStatus === 'partial') return 'posted';
  if (postStatus === 'posting') return 'running';
  if (postStatus === 'error') return 'failed';
  if (runStatus === 'failed') return 'failed';
  if (runStatus === 'running') return 'running';
  if (runStatus === 'needs_approval' || runStatus === 'needs_connection') return 'held';
  return 'planned';
};

export interface CampaignStatusRollup {
  campaignId: string;
  total: number;
  counts: Record<DerivedPostStatus, number>;
  posts: Array<{ postId: string; runId: string; status: DerivedPostStatus; scheduledAt: string | null }>;
}

export async function campaignStatusRollup(campaignId: string, ownerId: string): Promise<CampaignStatusRollup> {
  const plans = await getCampaignRunPlans(campaignId, ownerId);
  const counts: Record<DerivedPostStatus, number> = { planned: 0, running: 0, held: 0, posted: 0, failed: 0 };
  const posts = plans.map((p) => {
    const status = derive(p.postStatus, p.runStatus);
    counts[status]++;
    return { postId: p.postId, runId: p.runId, status, scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null };
  });
  return { campaignId, total: posts.length, counts, posts };
}
