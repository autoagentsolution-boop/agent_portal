// WorkflowRun repository — orchestration state machine (Milestone 1). Same TENANCY
// split as post-repo (T2): tenant-facing reads REQUIRE ownerId (wrong tenant →
// null → route 404); the executor owns a run it already fetched by id. Status is a
// free-form string; transitions are guarded with updateMany(count===1) like the
// post review gate so a stale UI can't double-advance a run.
import { prisma } from '../client.ts';
import { Prisma } from '../../../prisma/generated/prisma/client.ts';
import { creditsFromTokens } from '../../cost/credits.ts';
import type {
  WorkflowRun,
  WorkflowNodeRun,
} from '../../../prisma/generated/prisma/client.ts';

export type RunWithNodes = Prisma.WorkflowRunGetPayload<{
  include: { nodes: true; artifacts: true };
}>;

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
    include: { nodes: { orderBy: { nodeId: 'asc' } }, artifacts: { orderBy: { createdAt: 'asc' } } },
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
    include: { nodes: { orderBy: { nodeId: 'asc' } }, artifacts: { orderBy: { createdAt: 'asc' } } },
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
