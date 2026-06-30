// WorkflowRun repository — orchestration state machine (Milestone 1). Same TENANCY
// split as post-repo (T2): tenant-facing reads REQUIRE ownerId (wrong tenant →
// null → route 404); the executor owns a run it already fetched by id. Status is a
// free-form string; transitions are guarded with updateMany(count===1) like the
// post review gate so a stale UI can't double-advance a run.
import { prisma } from '../client.ts';
import { Prisma } from '../../../prisma/generated/prisma/client.ts';
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

// ── Tenant-facing reads (scoped) ─────────────────────────────────────────────
export const getRunForOwner = (id: string, ownerId: string): Promise<WorkflowRun | null> =>
  prisma.workflowRun.findFirst({ where: { id, ownerId } });

// Scoped delete (cascades to child nodes + artifacts via FK onDelete: Cascade).
// Refuses a run that is mid-execution (running) so a detached executor can't write to
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

// Named ("saved") runs for the Saved Flows surface. Only rows the user explicitly
// saved (name not null) — transient draft runs stay out of the list.
export const listSavedRuns = async (ownerId: string, limit = 50): Promise<RunListItem[]> => {
  const rows = await prisma.workflowRun.findMany({
    where: { ownerId, name: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, _count: { select: { nodes: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, nodeCount: r._count.nodes, createdAt: r.createdAt, updatedAt: r.updatedAt }));
};

// Name a planned run (Saved Flows). Guarded transition keeps it scoped + only names
// a run that is still planned (can't name a half-executed run). Returns row or null.
export const nameRun = async (id: string, ownerId: string, name: string): Promise<WorkflowRun | null> => {
  const r = await prisma.workflowRun.updateMany({ where: { id, ownerId, status: 'planned' }, data: { name } });
  return r.count === 1 ? prisma.workflowRun.findFirst({ where: { id, ownerId } }) : null;
};

// Restore the run behind a chat session (conversational unify): a chat may spawn
// many runs over its life; the latest is the live one the panel re-opens. Scoped by
// ownerId (tenant isolation) and returns null when the chat has no run yet.
export const getLatestRunWithNodesForChat = (
  chatSessionId: string,
  ownerId: string,
): Promise<RunWithNodes | null> =>
  prisma.workflowRun.findFirst({
    where: { chatSessionId, ownerId },
    orderBy: { updatedAt: 'desc' },
    include: { nodes: { orderBy: { nodeId: 'asc' } }, artifacts: { orderBy: { createdAt: 'asc' } } },
  });

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
