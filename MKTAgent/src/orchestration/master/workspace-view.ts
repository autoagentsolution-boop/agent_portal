// Workspace view-model (Atria v2 P0) — the thin read-model that reframes a Campaign as a
// "Workspace": a campaign room where a GROUP of agents work, each with live status + cost. ALL
// the data already exists (WorkflowRun / WorkflowNodeRun / mkt_llm_usage); this only presents it.
// No engine change — pure aggregation over existing repos (decision 1: hybrid, presentation only).
import { getAgent } from '../registry/agent-registry.ts';
import type { RunnableAgentId } from '../registry/agent-types.ts';
import { listCampaigns, getCampaign } from '../../db/repos/campaign-repo.ts';
import {
  campaignAgentRollup,
  type CampaignAgentRollup,
} from '../../db/repos/workflow-run-repo.ts';
import { campaignStatusRollup, type CampaignStatusRollup } from './campaign-grant.ts';

// One agent's card in the workspace dashboard — the rollup enriched with registry display data
// so the panel needs no second lookup. Unknown agentId (removed from registry) falls back to its id.
export interface WorkspaceAgentCard extends CampaignAgentRollup {
  name: string;
  emoji: string;
  group: string | null;
}

export interface WorkspaceSummary {
  campaignId: string;
  name: string;
  product: string;
  active: boolean;
  platforms: string[];
  postCount: number;
  counts: CampaignStatusRollup['counts'];
  costUsd: number;
  credits: number;
  updatedAt: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  posts: CampaignStatusRollup['posts'];
  agents: WorkspaceAgentCard[];
  totalTokens: number;
}

const enrichAgent = (r: CampaignAgentRollup): WorkspaceAgentCard => {
  const def = getAgent(r.agentId as RunnableAgentId);
  return {
    ...r,
    name: def?.name ?? r.agentId,
    emoji: def?.emoji ?? '🤖',
    group: def?.group ?? null,
  };
};

const campaignTitle = (product: string, angle: string | null): string =>
  product?.trim() || angle?.trim() || 'Untitled workspace';

// Sum a campaign's per-agent rollup into the workspace-level cost totals (one number the hub shows).
const costTotals = (agents: CampaignAgentRollup[]) =>
  agents.reduce(
    (acc, a) => {
      acc.costUsd += a.costUsd;
      acc.credits += a.credits;
      acc.totalTokens += a.totalTokens;
      return acc;
    },
    { costUsd: 0, credits: 0, totalTokens: 0 },
  );

// List every campaign as a workspace card for the Command Center / sidebar. N+1 over campaigns is
// acceptable at current tenant scale (a handful of campaigns); revisit with a batched query if a
// tenant grows large. Reads are owner-scoped inside each rollup.
export const listWorkspaces = async (ownerId: string): Promise<WorkspaceSummary[]> => {
  const campaigns = await listCampaigns(ownerId);
  return Promise.all(
    campaigns.map(async (c) => {
      const [status, agents] = await Promise.all([
        campaignStatusRollup(c.id, ownerId),
        campaignAgentRollup(c.id, ownerId),
      ]);
      const cost = costTotals(agents);
      return {
        campaignId: c.id,
        name: campaignTitle(c.product, c.angle),
        product: c.product,
        active: c.active,
        platforms: c.platforms,
        postCount: status.total,
        counts: status.counts,
        costUsd: cost.costUsd,
        credits: cost.credits,
        updatedAt: c.updatedAt.toISOString(),
      };
    }),
  );
};

// Full workspace room: campaign + its posts/runs + per-agent dashboard cards. null = not found /
// wrong tenant (route → 404).
export const getWorkspace = async (
  campaignId: string,
  ownerId: string,
): Promise<WorkspaceDetail | null> => {
  const campaign = await getCampaign(campaignId, ownerId);
  if (!campaign) return null;
  const [status, rollup] = await Promise.all([
    campaignStatusRollup(campaignId, ownerId),
    campaignAgentRollup(campaignId, ownerId),
  ]);
  const agents = rollup.map(enrichAgent);
  const cost = costTotals(rollup);
  return {
    campaignId: campaign.id,
    name: campaignTitle(campaign.product, campaign.angle),
    product: campaign.product,
    active: campaign.active,
    platforms: campaign.platforms,
    postCount: status.total,
    counts: status.counts,
    costUsd: cost.costUsd,
    credits: cost.credits,
    totalTokens: cost.totalTokens,
    updatedAt: campaign.updatedAt.toISOString(),
    posts: status.posts,
    agents,
  };
};
