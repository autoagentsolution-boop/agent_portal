// WorkflowRun repository — orchestration state machine (Milestone 1). Same TENANCY
// split as post-repo (T2): tenant-facing reads REQUIRE ownerId (wrong tenant →
// null → route 404); the executor owns a run it already fetched by id. Status is a
// free-form string; transitions are guarded with updateMany(count===1) like the
// post review gate so a stale UI can't double-advance a run.
import { prisma } from '../client.ts';
import { Prisma } from '../../../prisma/generated/prisma/client.ts';
import { creditsFromTokens, creditsFromUsd } from '../../cost/credits.ts';
import { getAgent } from '../../orchestration/registry/agent-registry.ts';
import type { RunnableAgentId } from '../../orchestration/registry/agent-types.ts';
import type {
  WorkflowRun,
  WorkflowNodeRun,
} from '../../../prisma/generated/prisma/client.ts';

export type RunWithNodes = Prisma.WorkflowRunGetPayload<{
  include: { nodes: true; artifacts: true; posts: { select: { id: true; campaignId: true } } };
}>;

// The post backing a run carries the campaignId (WorkflowRun has no direct column). A run has at
// most one real post; return its campaignId so the DTO can gate campaign-only actions (per-post
// autonomy grant). null when the run has no post or the post isn't under a campaign.
export const runCampaignId = (run: RunWithNodes): string | null =>
  run.posts.find((p) => p.campaignId)?.campaignId ?? null;

export interface CreateRunArgs {
  ownerId: string;
  chatSessionId?: string | null;
  goal: object;
  plan?: object | null;
  status: string;
}

export const createRun = (args: CreateRunArgs): Promise<WorkflowRun> =>
  prisma.workflowRun.create({
    data: {
      ownerId: args.ownerId,
      chatSessionId: args.chatSessionId ?? null,
      goal: args.goal,
      plan: args.plan ?? undefined,
      status: args.status,
    },
  });

// Persist the planned node set for a run (called when status → planned).
export const createNodes = async (
  runId: string,
  ownerId: string,
  nodes: Array<{ nodeId: string; agentId: string; dependsOn: string[] }>,
): Promise<void> => {
  if (nodes.length === 0) return;
  await prisma.workflowNodeRun.createMany({
    data: nodes.map((n) => ({
      runId,
      ownerId,
      nodeId: n.nodeId,
      agentId: n.agentId,
      dependsOn: n.dependsOn,
      inputRefs: [],
      outputRefs: [],
      status: 'pending',
    })),
  });
};

// Drop a run's planned nodes before a re-plan (conversational refinement can change
// the DAG of an already-planned run). Scoped by ownerId for tenant safety.
export const deleteNodes = async (runId: string, ownerId: string): Promise<void> => {
  await prisma.workflowNodeRun.deleteMany({ where: { runId, ownerId } });
};

// Per-post overrides applied when cloning a template — the parent Campaign's strategy
// (product/angle/voice/language/platforms) so a post inherits its campaign's intent
// while reusing the flow's agent DAG. Only non-null fields override the template goal.
export interface CloneGoalOverrides {
  product?: string | null;
  angle?: string | null;
  brandVoice?: string | null;
  language?: string | null;
  productDetails?: string | null;
  platforms?: string[];
}

// Merge campaign overrides onto the template's frozen goal snapshot. Keeps the template
// goal shape intact (outputs/confidence/provider) and only overrides the strategy slots
// + platforms the campaign supplies. A blank override never clobbers a real value.
const mergeGoal = (templateGoal: unknown, o: CloneGoalOverrides): object => {
  const base = (templateGoal ?? {}) as { slots?: Record<string, unknown>; platforms?: string[] };
  const slots = { ...(base.slots ?? {}) };
  const set = (k: string, v: string | null | undefined) => { if (v && v.trim()) slots[k] = v.trim(); };
  set('product', o.product);
  set('angle', o.angle);
  set('brandVoice', o.brandVoice);
  set('language', o.language);
  set('productDetails', o.productDetails);
  return {
    ...base,
    slots,
    ...(o.platforms && o.platforms.length ? { platforms: o.platforms } : {}),
  };
};

// Clone a Flow template into a fresh, executable instance run (one per Post). Copies
// the template's frozen goal + DAG plan, applies per-post overrides (from the parent
// Campaign's strategy), and creates the node set as pending. The instance is `planned`
// so the Post can execute it independently — the template itself is never run. Returns
// null if the template is missing / wrong tenant / not actually a template.
export const cloneTemplateRun = async (
  templateId: string,
  ownerId: string,
  overrides: CloneGoalOverrides = {},
): Promise<WorkflowRun | null> => {
  const template = await prisma.workflowRun.findFirst({ where: { id: templateId, ownerId, kind: 'template' } });
  if (!template || !template.plan) return null;
  const plan = template.plan as { nodes: Array<{ nodeId: string; agentId: string; dependsOn: string[] }> };
  // Registry re-validation (Phase 05 / D#8): a frozen template captured agentIds that may since have
  // been removed/renamed in the live registry. Cloning it verbatim would create an instance that
  // crashes at execute time (getAgent → undefined). Fail LOUD with the offending agent(s) instead —
  // the flow needs re-authoring, not a silent broken post.
  const missing = [...new Set(plan.nodes.map((n) => n.agentId).filter((id) => !getAgent(id as RunnableAgentId)))];
  if (missing.length) {
    throw new Error(`template references removed agent(s): ${missing.join(', ')} — re-create this flow`);
  }
  const instance = await prisma.workflowRun.create({
    data: {
      ownerId,
      chatSessionId: template.chatSessionId,
      goal: mergeGoal(template.goal, overrides) as Prisma.InputJsonValue,
      plan: template.plan as Prisma.InputJsonValue,
      status: 'planned',
      kind: 'instance',
      locked: false,
      templateId: template.id,
    },
  });
  await createNodes(instance.id, ownerId, plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
  return instance;
};

// ── Tenant-facing reads (scoped) ─────────────────────────────────────────────
export const getRunForOwner = (id: string, ownerId: string): Promise<WorkflowRun | null> =>
  prisma.workflowRun.findFirst({ where: { id, ownerId } });

// Resolve each campaign to the chat session that spawned its work, so a "Workspace" can reopen the
// originating master-agent conversation (v2 "continue chat"). Link is indirect — campaign → its most
// recent post's run → run.chatSessionId. Batched (2 queries total, not N+1). A campaign with no
// posts / no chat-linked run maps to null (continue-chat disabled for it).
export const chatSessionsForCampaigns = async (
  ownerId: string,
  campaignIds: string[],
): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  if (campaignIds.length === 0) return out;
  const posts = await prisma.post.findMany({
    where: { ownerId, campaignId: { in: campaignIds }, runId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { campaignId: true, runId: true },
  });
  const runIdByCampaign = new Map<string, string>();
  for (const p of posts) if (p.runId && !runIdByCampaign.has(p.campaignId)) runIdByCampaign.set(p.campaignId, p.runId);
  const runIds = [...new Set(runIdByCampaign.values())];
  if (runIds.length === 0) return out;
  const runs = await prisma.workflowRun.findMany({
    where: { ownerId, id: { in: runIds }, chatSessionId: { not: null } },
    select: { id: true, chatSessionId: true },
  });
  const chatByRun = new Map(runs.map((r) => [r.id, r.chatSessionId!]));
  for (const [campaignId, runId] of runIdByCampaign) {
    const chat = chatByRun.get(runId);
    if (chat) out.set(campaignId, chat);
  }
  return out;
};

// Scoped delete (cascades to child nodes + artifacts via FK onDelete: Cascade).
// Refuses a run that is mid-execution (running) so a detached executor can't write to
// Cheap run-status read for the detached executor's between-node abort check (§kill switch).
// No owner scope — the executor is trusted and holds the runId. null = run gone.
export const getRunStatusById = async (id: string): Promise<string | null> =>
  (await prisma.workflowRun.findUnique({ where: { id }, select: { status: true } }))?.status ?? null;

// Is a post's flow still actively producing (a node running/pending — e.g. a video still
// generating)? The scheduler uses this to DELAY a scheduled publish until the flow finishes, so a
// post never goes out before its media is ready. Terminal (completed/skipped/failed) + parked
// (awaiting_approval) states don't count as active — only work still in flight.
export const hasActiveFlowNodes = async (runId: string): Promise<boolean> =>
  (await prisma.workflowNodeRun.count({ where: { runId, status: { in: ['running', 'pending'] } } })) > 0;

// Should the SCHEDULER hold a due post whose flow is this run? (Phase 03 / C2-A#1-B#3). Wider than
// hasActiveFlowNodes: a post can reach `ready` at the concept gate while its run is still PARKED at
// a later gate (e.g. the pre-video cost gate) — hasActiveFlowNodes missed that (it counts only
// running/pending, not awaiting_approval), so the cron published before media existed. Blocked when:
//   • any node is running/pending/awaiting_approval (flow still producing OR parked at a gate), OR
//   • the run itself is non-terminal (needs_approval | running | needs_connection | planning), OR
//   • the run is an atria GRANT whose finalized schedule was NOT re-confirmed (scheduleConfirmed
//     =false — the "xác nhận lại 1 lần nữa" step): never auto-fire an unconfirmed autonomous schedule.
// A terminal run (completed) with all nodes terminal and (human OR scheduleConfirmed) → NOT blocked.
const NON_TERMINAL_RUN = ['planning', 'awaiting_clarification', 'planned', 'running', 'needs_approval', 'needs_connection'];
export const isPublishBlocked = async (runId: string): Promise<boolean> => {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { status: true, approvalMode: true, scheduleConfirmed: true },
  });
  if (!run) return false; // no run → a legacy standalone post; the post's own state gates it
  if (NON_TERMINAL_RUN.includes(run.status)) return true;
  if (run.approvalMode === 'atria' && !run.scheduleConfirmed) return true;
  const parked = await prisma.workflowNodeRun.count({
    where: { runId, status: { in: ['running', 'pending', 'awaiting_approval'] } },
  });
  return parked > 0;
};

// a deleted run. Returns: 'deleted' | 'not_found' (wrong tenant / id) | 'in_flight'.
export const deleteRun = async (
  id: string,
  ownerId: string,
): Promise<'deleted' | 'not_found' | 'in_flight'> => {
  const run = await prisma.workflowRun.findFirst({ where: { id, ownerId }, select: { status: true } });
  if (!run) return 'not_found';
  if (run.status === 'running') return 'in_flight';
  const r = await prisma.workflowRun.deleteMany({ where: { id, ownerId } });
  return r.count === 1 ? 'deleted' : 'not_found';
};

export const getRunWithNodes = (id: string, ownerId: string): Promise<RunWithNodes | null> =>
  prisma.workflowRun.findFirst({
    where: { id, ownerId },
    include: {
      nodes: { orderBy: { nodeId: 'asc' } },
      artifacts: { orderBy: { createdAt: 'asc' } },
      posts: { select: { id: true, campaignId: true } },
    },
  });

// Token/cost rollup for a flow TEMPLATE: sum every node of every instance run spawned
// from it (templateId=flow.id) + the template's own nodes (0 — templates never execute).
// This is what turns a Flow detail into a real dashboard: total spend across all its
// posts. Scoped by owner. `runs` = how many instance runs contributed (posts executed).
export interface FlowCostRollup {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  credits: number;
  runs: number;
}

// Per-agent historical token/cost averages from completed node runs — the REAL data behind
// the multi-tier plan estimates (Phase 03). Only rows that actually spent (totalTokens > 0) so
// stubs/skips don't drag the average to zero. Optionally owner-scoped; global average is the
// fallback when a specific owner has no history yet.
export interface AgentCostAverage { agentId: string; avgTotalTokens: number; avgCostUsd: number; samples: number }
export const agentCostAverages = async (ownerId?: string): Promise<AgentCostAverage[]> => {
  const grouped = await prisma.workflowNodeRun.groupBy({
    by: ['agentId'],
    where: { totalTokens: { gt: 0 }, ...(ownerId ? { ownerId } : {}) },
    _avg: { totalTokens: true, costUsd: true },
    _count: true,
  });
  return grouped.map((g) => ({
    agentId: g.agentId,
    avgTotalTokens: Math.round(g._avg.totalTokens ?? 0),
    avgCostUsd: g._avg.costUsd ?? 0,
    samples: g._count,
  }));
};

export const getFlowCostRollup = async (templateId: string, ownerId: string): Promise<FlowCostRollup> => {
  const instances = await prisma.workflowRun.findMany({
    where: { ownerId, templateId },
    select: { id: true },
  });
  const runIds = instances.map((r) => r.id);
  if (runIds.length === 0) return { promptTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, credits: 0, runs: 0 };
  const agg = await prisma.workflowNodeRun.aggregate({
    where: { ownerId, runId: { in: runIds } },
    _sum: { promptTokens: true, outputTokens: true, totalTokens: true, costUsd: true },
  });
  const totalTokens = agg._sum.totalTokens ?? 0;
  return {
    promptTokens: agg._sum.promptTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    totalTokens,
    costUsd: agg._sum.costUsd ?? 0,
    credits: creditsFromTokens(totalTokens),
    runs: runIds.length,
  };
};

// Total credits a single run consumed = token-passthrough credits + media-USD credits, summed
// over all its node runs (same basis as impact-metrics). The debit amount for the credit wallet.
export const runCredits = async (runId: string, ownerId: string): Promise<number> => {
  const agg = await prisma.workflowNodeRun.aggregate({
    where: { ownerId, runId },
    _sum: { totalTokens: true, costUsd: true },
  });
  return creditsFromTokens(agg._sum.totalTokens ?? 0) + creditsFromUsd(agg._sum.costUsd ?? 0);
};

// Per-AGENT rollup across a whole campaign's posts (Atria v2 P0 — the Workspace dashboard's
// "cost by agent": Researcher 42cr / Editor 38cr…). Aggregates every node run of every post's
// run in the campaign, grouped by agentId, with token/cost sums + a status breakdown. Read-only
// over existing tables — no engine change. Owner-scoped: reads only the caller's posts/runs.
// Node counts per campaign are small (posts × ~8 agents), so we fetch rows and reduce in JS
// rather than firing two groupBy round-trips.
export interface CampaignAgentRollup {
  agentId: string;
  totalTokens: number;
  costUsd: number;
  credits: number;
  runs: number; // node-run instances for this agent across the campaign
  completed: number;
  running: number;
  failed: number;
  // pending (queued, not yet started) = runs - completed - running - failed (derived, not stored).
}
export const campaignAgentRollup = async (
  campaignId: string,
  ownerId: string,
): Promise<CampaignAgentRollup[]> => {
  const posts = await prisma.post.findMany({
    where: { campaignId, ownerId, runId: { not: null } },
    select: { runId: true },
  });
  const runIds = [...new Set(posts.map((p) => p.runId).filter((r): r is string => Boolean(r)))];
  if (runIds.length === 0) return [];
  const nodes = await prisma.workflowNodeRun.findMany({
    where: { ownerId, runId: { in: runIds } },
    select: { agentId: true, status: true, totalTokens: true, costUsd: true },
  });
  const byAgent = new Map<string, CampaignAgentRollup>();
  for (const n of nodes) {
    const r =
      byAgent.get(n.agentId) ??
      { agentId: n.agentId, totalTokens: 0, costUsd: 0, credits: 0, runs: 0, completed: 0, running: 0, failed: 0 };
    r.totalTokens += n.totalTokens ?? 0;
    r.costUsd += n.costUsd ?? 0;
    r.runs += 1;
    if (n.status === 'completed') r.completed += 1;
    else if (n.status === 'running') r.running += 1;
    else if (n.status === 'failed') r.failed += 1;
    // pending/awaiting_approval fall through — derivable as runs - completed - running - failed.
    byAgent.set(n.agentId, r);
  }
  return [...byAgent.values()]
    .map((r) => ({ ...r, credits: creditsFromTokens(r.totalTokens) }))
    .sort((a, b) => b.costUsd - a.costUsd);
};

export const listRuns = (ownerId: string, limit = 50): Promise<WorkflowRun[]> =>
  prisma.workflowRun.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' }, take: limit });

// Saved Flows list item — a named run plus its node count (for the sidebar/Active
// Flows summary, without shipping the whole plan + artifacts).
export interface RunListItem {
  id: string;
  name: string | null;
  status: string;
  nodeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Flow templates for the Saved Flows sidebar. A saved+approved flow is a `template`
// (immutable blueprint); instance runs (one per Post) are hidden here — they surface
// under their Post. Legacy named runs are kind=instance and intentionally excluded so
// the sidebar shows only reusable blueprints.
export const listSavedRuns = async (ownerId: string, limit = 50): Promise<RunListItem[]> => {
  const rows = await prisma.workflowRun.findMany({
    where: { ownerId, kind: 'template', name: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, _count: { select: { nodes: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, nodeCount: r._count.nodes, createdAt: r.createdAt, updatedAt: r.updatedAt }));
};

// Resumable in-flight run (Command Center "Continue where you left off"). A non-marketing Atria run —
// email / task flow — is a kind='instance' with NO Post/campaign, so it surfaces NOWHERE else (Saved
// Flows = templates only; Scheduled = already-approved 'scheduled'; Workspace = campaigns). Without this
// a run paused at an approval gate is reachable only by remembering which chat spawned it. We list the
// post-less instance runs that STARTED executing and paused, newest first. 'planned' is deliberately
// excluded — a not-yet-executed proposal is transient and would flood the cards with abandoned drafts;
// the recent-chat card already covers resuming those.
export interface ResumableRunItem { id: string; name: string | null; status: string; chatSessionId: string | null; updatedAt: Date }
const RESUMABLE_STATUSES = ['needs_approval', 'needs_connection', 'running'];
export const listResumableRuns = async (ownerId: string, limit = 10): Promise<ResumableRunItem[]> => {
  const rows = await prisma.workflowRun.findMany({
    where: { ownerId, kind: 'instance', status: { in: RESUMABLE_STATUSES }, chatSessionId: { not: null }, posts: { none: {} } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, name: true, status: true, chatSessionId: true, updatedAt: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, chatSessionId: r.chatSessionId, updatedAt: r.updatedAt }));
};

// Name a planned run AND freeze it into a Flow template (Saved Flows). Guarded
// transition keeps it scoped + only names a run that is still planned AND not yet named
// — /save is the FIRST-time save, so a second call must no-op (renames go through
// renameRun/PATCH). Without the `name: null` guard a re-save would re-stamp the name and
// re-post the P6 offer turn. Approving a flow makes it an immutable blueprint:
// kind=template, status=template, locked — the master agent can no longer mutate it, and
// it is never executed (each Post clones it into an instance run). Returns row/null.
export const nameRun = async (id: string, ownerId: string, name: string): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({
    where: { id, ownerId, status: 'planned', name: null },
    data: { name, kind: 'template', status: 'template', locked: true },
  });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id, ownerId } }) : null;
};

// Rename an EXISTING saved flow regardless of status (unlike nameRun, which only stamps
// a fresh planned run). Owner-scoped; returns null on wrong tenant / missing id. Used by
// PATCH /runs/:id so a user can rename a flow they've already executed.
export const renameRun = async (id: string, ownerId: string, name: string): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({ where: { id, ownerId }, data: { name } });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id, ownerId } }) : null;
};

// Restore the run behind a chat session (conversational unify): a chat may spawn
// many runs over its life; the latest is the live one the panel re-opens. Scoped by
// ownerId (tenant isolation) and returns null when the chat has no run yet.
// The chat's CONVERSATIONAL run — the draft/template the conversation is about. CLONED
// per-post instances are excluded via templateId (NOT `kind`): cloneTemplateRun copies the
// template's chatSessionId onto each post's instance, so without this filter a newer clone
// would shadow the conversation and break (a) the saved-flow reuse guard (2nd campaign-
// create forks instead of binding) and (b) chat restore (would show a post's instance).
// ⚠ Filter on `templateId: null`, NOT `kind != instance`: a fresh conversational DRAFT run
// defaults to kind='instance' (schema default) with templateId=null, so a kind filter would
// wrongly exclude the chat's own draft → refine() never fires → the agent re-asks everything
// it already gathered. Only CLONES set templateId; drafts and templates leave it null.
export const getLatestRunWithNodesForChat = (
  chatSessionId: string,
  ownerId: string,
): Promise<RunWithNodes | null> =>
  prisma.workflowRun.findFirst({
    where: { chatSessionId, ownerId, templateId: null },
    orderBy: { updatedAt: 'desc' },
    include: {
      nodes: { orderBy: { nodeId: 'asc' } },
      artifacts: { orderBy: { createdAt: 'asc' } },
      posts: { select: { id: true, campaignId: true } },
    },
  });

// Atria autonomy grant (Phase 01): flip a run into 'atria' approval mode after the user
// double-confirmed it (the endpoint enforces the two-step handshake). Owner-scoped and
// guarded to a run the user could still execute (planned/failed/needs_connection) so a
// running/completed/template run can't be retro-granted. `scheduleConfirmed` is set true
// when the user re-confirmed a finalized schedule (Phase 03 scheduler reads it). Returns
// the updated row or null (wrong tenant / not in a grantable state).
export const grantAutonomy = async (
  id: string,
  ownerId: string,
  scheduleConfirmed = false,
): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({
    where: { id, ownerId, status: { in: ['planned', 'failed', 'needs_connection'] } },
    data: { approvalMode: 'atria', scheduleConfirmed },
  });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id, ownerId } }) : null;
};

// Campaign-level autonomy grant (Atria Phase 05): flip EVERY materialized post's run in a campaign
// into 'atria' mode in ONE audited action, guarded per-run to a grantable state (a running/posted
// post's run is left alone → no double-publish, no autonomy leak). Owner-scoped. Returns the count
// actually flipped. The endpoint enforces the campaign-scoped double-confirm before calling this.
export const grantAutonomyForCampaign = async (
  campaignId: string,
  ownerId: string,
  scheduleConfirmed = false,
): Promise<{ granted: number; runIds: string[] }> => {
  const posts = await prisma.post.findMany({ where: { campaignId, ownerId, runId: { not: null } }, select: { runId: true } });
  const runIds = [...new Set(posts.map((p) => p.runId).filter((r): r is string => Boolean(r)))];
  if (runIds.length === 0) return { granted: 0, runIds: [] };
  const r = await prisma.workflowRun.updateMany({
    where: { id: { in: runIds }, ownerId, status: { in: ['planned', 'failed', 'needs_connection'] } },
    data: { approvalMode: 'atria', scheduleConfirmed },
  });
  return { granted: r.count, runIds };
};

// Per-run plan node agent ids for a campaign's posts (Phase 05 cost estimate). Reads each backing
// run's frozen plan snapshot. Owner-scoped.
// One run's plan agent ids (for the per-post autonomy-grant cost estimate). Owner-scoped; [] on miss.
export const getRunPlanAgents = async (runId: string, ownerId: string): Promise<string[]> => {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, ownerId }, select: { plan: true } });
  const nodes = (run?.plan as { nodes?: Array<{ agentId: string }> } | null)?.nodes ?? [];
  return nodes.map((n) => n.agentId);
};

export const getCampaignRunPlans = async (
  campaignId: string,
  ownerId: string,
): Promise<Array<{ runId: string; postId: string; postStatus: string; agentIds: string[]; runStatus: string; scheduledAt: Date | null }>> => {
  const posts = await prisma.post.findMany({
    where: { campaignId, ownerId, runId: { not: null } },
    select: { id: true, status: true, scheduledAt: true, runId: true, run: { select: { id: true, status: true, plan: true } } },
    orderBy: { scheduledAt: 'asc' },
  });
  return posts
    .filter((p) => p.run)
    .map((p) => {
      const plan = p.run!.plan as { nodes?: Array<{ agentId: string }> } | null;
      return {
        runId: p.run!.id,
        postId: p.id,
        postStatus: p.status,
        agentIds: plan?.nodes?.map((n) => n.agentId) ?? [],
        runStatus: p.run!.status,
        scheduledAt: p.scheduledAt,
      };
    });
};

// ── Self-healing reaper queries (Phase 04) ────────────────────────────────────
// Owner-AGNOSTIC worker-path reads (same pattern as the scheduler/leads crons): the reaper is a
// trusted background sweep, not a tenant request, so it scans across owners then writes scoped by
// the row's own id. Read-then-scoped-write — no cross-tenant leak.

// Runs stuck `running` past the timeout (updatedAt is touched on every status/node write via
// @updatedAt, so a live run keeps refreshing it; only a crashed/detached-dead run ages out).
export const findStaleRunningRuns = (before: Date): Promise<WorkflowRun[]> =>
  prisma.workflowRun.findMany({ where: { status: 'running', updatedAt: { lt: before } } });

// Nodes stuck `running` — aged by `startedAt` (set when the node flips to running). Returns
// candidates older than the SHORTER (non-video) timeout; the reaper applies the video-specific
// budget per-node by agentId so a legitimately-long Veo render isn't false-reaped.
export interface StaleNode { id: string; runId: string; ownerId: string; agentId: string; nodeId: string; startedAt: Date | null }
export const findStaleRunningNodes = (before: Date): Promise<StaleNode[]> =>
  prisma.workflowNodeRun.findMany({
    where: { status: 'running', startedAt: { lt: before } },
    select: { id: true, runId: true, ownerId: true, agentId: true, nodeId: true, startedAt: true },
  });

// Orphaned runs parked long past any reasonable human-action window (needs_approval/planned).
// Surfaced (logged/notified) for cleanup — NOT auto-deleted (the user may still act on them).
export const findOrphanedRuns = (before: Date): Promise<WorkflowRun[]> =>
  prisma.workflowRun.findMany({
    where: { status: { in: ['needs_approval', 'planned', 'needs_connection'] }, updatedAt: { lt: before } },
  });

// Autonomy kickoff (Phase 04): a GRANTED run (approvalMode='atria') left at 'planned' has nothing
// to start it — the scheduler only publishes `ready` posts. The autonomy cron claims one atomically
// (updateMany guarded on 'planned' so overlapping ticks/workers can't double-execute) and runs it.
// `status:'planned'` already excludes templates (status='template') and in-flight runs. Returns the
// claimed run (now 'running') or null when nothing is claimable / the claim was lost to a race.
export const claimNextGrantedRun = async (): Promise<WorkflowRun | null> => {
  const candidate = await prisma.workflowRun.findFirst({
    where: { approvalMode: 'atria', status: 'planned' },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
  });
  if (!candidate) return null;
  const claim = await prisma.workflowRun.updateMany({
    where: { id: candidate.id, approvalMode: 'atria', status: 'planned' },
    data: { status: 'running' },
  });
  return claim.count === 1 ? prisma.workflowRun.findUnique({ where: { id: candidate.id } }) : null;
};

// Reaper writes (scoped by the row's own id; guarded on the stuck state so a concurrent legit
// transition wins the race — the reaper never clobbers a row that just moved on).
export const reapRunToFailed = async (id: string): Promise<boolean> => {
  const r = await prisma.workflowRun.updateMany({ where: { id, status: 'running' }, data: { status: 'failed' } });
  return r.count === 1;
};
export const reapNodeToFailed = async (id: string, error: string): Promise<boolean> => {
  const r = await prisma.workflowNodeRun.updateMany({ where: { id, status: 'running' }, data: { status: 'failed', error: error.slice(0, 500), finishedAt: new Date() } });
  return r.count === 1;
};

// Detached-executor crash recovery (Phase 04): the fire-and-forget `void runWorkflow().catch()`
// only rejects when the run threw OUTSIDE the per-node try/catch (which already fails the node+run).
// In that case the run is wedged `running` with a still-`running` node → mark BOTH failed so the
// crash surfaces as `failed` (not a hung HTTP 200) — the reaper is the backstop if the process died.
// Guarded on `running`, so a run that legitimately moved on is untouched. Returns run reaped?.
export const markRunCrashed = async (runId: string, error: string): Promise<boolean> => {
  await prisma.workflowNodeRun.updateMany({ where: { runId, status: 'running' }, data: { status: 'failed', error: error.slice(0, 500), finishedAt: new Date() } });
  const r = await prisma.workflowRun.updateMany({ where: { id: runId, status: 'running' }, data: { status: 'failed' } });
  return r.count === 1;
};

// ── Generic scheduler (2026-07-12) ───────────────────────────────────────────
// Park a run at its scheduler gate for a timed re-entry. Guarded on `needs_approval` (the state the
// executor left it in at the schedule-gate halt) so a stale double-approve can't re-park. Records the
// confirmed resume instant + flips scheduleConfirmed (the cron requires it), and marks the scheduler
// NODE completed so the resume-safe executor skips it on re-entry. Owner-scoped. null = stale/wrong-tenant.
export const parkScheduled = async (
  runId: string,
  ownerId: string,
  at: Date,
  schedulerNodeId: string,
): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({
    where: { id: runId, ownerId, status: 'needs_approval' },
    data: { status: 'scheduled', scheduledResumeAt: at, scheduleConfirmed: true },
  });
  if (r.count !== 1) return null;
  await prisma.workflowNodeRun.updateMany({
    where: { runId, ownerId, nodeId: schedulerNodeId },
    data: { status: 'completed', finishedAt: new Date() },
  });
  return prisma.workflowRun.findFirst({ where: { id: runId, ownerId } });
};

// Re-park an already-scheduled run at a NEW time (Reschedule). Guarded on `scheduled` so a run the cron
// just claimed (now `running`) can't be moved mid-fire — the reschedule no-ops (null) and the UI refreshes.
export const reparkScheduled = async (runId: string, ownerId: string, at: Date): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({
    where: { id: runId, ownerId, status: 'scheduled' },
    data: { scheduledResumeAt: at, scheduleConfirmed: true },
  });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id: runId, ownerId } }) : null;
};

// Cancel a scheduled run before it fires. Guarded on `scheduled` so a cancel racing the cron's claim
// (scheduled → running) no-ops rather than clobbering a run that already began publishing/sending.
export const cancelScheduled = async (runId: string, ownerId: string): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({
    where: { id: runId, ownerId, status: 'scheduled' },
    data: { status: 'cancelled', scheduledResumeAt: null },
  });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id: runId, ownerId } }) : null;
};

// Owner-scoped list of parked runs for the Scheduled page (status='scheduled', soonest first).
export const listScheduledRuns = (ownerId: string): Promise<WorkflowRun[]> =>
  prisma.workflowRun.findMany({
    where: { ownerId, status: 'scheduled' },
    orderBy: { scheduledResumeAt: 'asc' },
  });

// Atomically claim ONE due scheduled run for the resumeDueRuns cron (scheduled → running, oldest first,
// one per tick). Owner-AGNOSTIC read (trusted background sweep, like the publish tick) then a guarded
// updateMany scoped by the row's own id — the atomic claim guards double-fire even if the advisory lock
// were ever bypassed. Requires scheduleConfirmed so an unconfirmed schedule is never auto-fired.
export const claimScheduledDue = async (now: Date): Promise<WorkflowRun | null> => {
  const candidate = await prisma.workflowRun.findFirst({
    where: { status: 'scheduled', scheduleConfirmed: true, scheduledResumeAt: { lte: now } },
    orderBy: { scheduledResumeAt: 'asc' },
    select: { id: true },
  });
  if (!candidate) return null;
  const claim = await prisma.workflowRun.updateMany({
    where: { id: candidate.id, status: 'scheduled', scheduleConfirmed: true, scheduledResumeAt: { lte: now } },
    data: { status: 'running' },
  });
  return claim.count === 1 ? prisma.workflowRun.findUnique({ where: { id: candidate.id } }) : null;
};

// ── Transitions ──────────────────────────────────────────────────────────────
// Guarded status transition: only advance if currently in `from` AND owned by
// the caller. Returns the row or null (stale/wrong-tenant) — route maps null→409.
export const transitionRun = async (
  id: string,
  ownerId: string,
  from: string,
  to: string,
  data: Prisma.WorkflowRunUpdateInput = {},
): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({
    where: { id, ownerId, status: from },
    data: { ...data, status: to },
  });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id, ownerId } }) : null;
};

// Executor-side write (run already fetched/owned) — keyed by id only.
export const setRunStatus = (
  id: string,
  status: string,
  data: Prisma.WorkflowRunUpdateInput = {},
): Promise<WorkflowRun> =>
  prisma.workflowRun.update({ where: { id }, data: { ...data, status } });

// Re-plan an existing run: update goal + status, and set plan (or clear it with
// Prisma.JsonNull when a refinement dropped back to awaiting_clarification/failed).
// Keeps the Json-null quirk inside the repo layer.
export const replanRun = (
  id: string,
  status: string,
  goal: object,
  plan: object | null,
): Promise<WorkflowRun> =>
  prisma.workflowRun.update({
    where: { id },
    data: { status, goal, plan: plan ?? Prisma.JsonNull },
  });

// ── Node-level writes (executor owns the run) ────────────────────────────────
export const setNodeStatus = (
  id: string,
  status: string,
  data: Prisma.WorkflowNodeRunUpdateInput = {},
): Promise<WorkflowNodeRun> =>
  prisma.workflowNodeRun.update({ where: { id }, data: { ...data, status } });

export const listNodes = (runId: string): Promise<WorkflowNodeRun[]> =>
  prisma.workflowNodeRun.findMany({ where: { runId }, orderBy: { nodeId: 'asc' } });

// Reset a set of nodes back to `pending` (clearing error + timing) so they can re-run.
// Used by single-node re-execute: the target node plus its transitive dependents (which
// are now stale). Owner-scoped. Returns the count reset.
export const resetNodes = async (
  runId: string,
  ownerId: string,
  nodeIds: string[],
): Promise<number> => {
  if (nodeIds.length === 0) return 0;
  const r = await prisma.workflowNodeRun.updateMany({
    where: { runId, ownerId, nodeId: { in: nodeIds } },
    data: { status: 'pending', error: null, startedAt: null, finishedAt: null, outputRefs: [] },
  });
  return r.count;
};

// Transitive dependents of a node within a run (everything downstream that must be
// considered stale when the node re-runs). Pure graph walk over dependsOn edges.
export const collectDownstream = (
  nodes: Array<{ nodeId: string; dependsOn: string[] }>,
  startNodeId: string,
): string[] => {
  const dependentsOf = new Map<string, string[]>();
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      const arr = dependentsOf.get(dep) ?? [];
      arr.push(n.nodeId);
      dependentsOf.set(dep, arr);
    }
  }
  const out = new Set<string>();
  const stack = [startNodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of dependentsOf.get(cur) ?? []) {
      if (!out.has(child)) { out.add(child); stack.push(child); }
    }
  }
  return [...out];
};
