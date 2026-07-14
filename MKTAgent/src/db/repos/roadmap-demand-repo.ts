// Roadmap-demand repo (Atria Phase 06). Owner-scoped append-only log of roadmap-agent pitches +
// accepts — the real per-tenant demand signal for what to build next. No PII (agent id + signal label).
// Extended (P1b Phase 02): 'requested' rows record a CAPABILITY GAP — the user actively asked for a
// capability no agent node produces yet — with an auto-generated drop-in spec for the team to build.
import { prisma } from '../client.ts';
import type { RoadmapDemand, Prisma } from '../../../prisma/generated/prisma/client.ts';

export const logRoadmapDemand = (
  ownerId: string,
  agentId: string,
  action: 'pitched' | 'accepted',
  signal?: string | null,
): Promise<RoadmapDemand> =>
  prisma.roadmapDemand.create({ data: { ownerId, agentId, action, signal: signal ?? null } });

// Whether this owner was already pitched a given roadmap agent (so Atria doesn't nag repeatedly).
export const wasPitched = async (ownerId: string, agentId: string): Promise<boolean> =>
  (await prisma.roadmapDemand.count({ where: { ownerId, agentId, action: 'pitched' } })) > 0;

// The drop-in spec Atria auto-generates for a missing capability — shaped like a registry AgentDefinition
// so a dev can scaffold the node (registry entry + runner) with no planner changes. All optional: the
// brain fills what it can infer from the user's ask.
export interface CapabilityGapSpec {
  produces?: string;
  requires?: string[];
  suggestedGate?: string;
  exampleTask?: string;
  whatItWouldDo?: string;
}

// Whether this owner already requested a given capability (dedup — one demand row per capability, no spam).
export const wasRequested = async (ownerId: string, capabilityId: string): Promise<boolean> =>
  (await prisma.roadmapDemand.count({ where: { ownerId, agentId: capabilityId, action: 'requested' } })) > 0;

// Record a capability gap as demand. Deduped per (owner, capability): returns false if already logged.
export const recordCapabilityGap = async (
  ownerId: string,
  capabilityId: string,
  signal: string | null,
  spec: CapabilityGapSpec | null,
): Promise<boolean> => {
  if (await wasRequested(ownerId, capabilityId)) return false;
  await prisma.roadmapDemand.create({
    data: { ownerId, agentId: capabilityId, action: 'requested', signal: signal ?? null, spec: (spec ?? undefined) as Prisma.InputJsonValue | undefined },
  });
  return true;
};

// All demand rows for an owner (newest first) — the DEV backlog surface. Includes pitched/accepted/requested.
export const listDemand = (ownerId: string): Promise<RoadmapDemand[]> =>
  prisma.roadmapDemand.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });

// PLATFORM-WIDE capability-request backlog for the super-admin console (credit-wallet Phase 03):
// every 'requested' gap across ALL tenants, grouped by capability, with request count + tenant reach +
// first/last seen + the latest drop-in spec. This is the "what to build next" board. Small table, so
// fetch + reduce in JS rather than a grouped SQL round-trip.
export interface CapabilityRequestSummary {
  capabilityId: string;
  requests: number; // total 'requested' rows for this capability
  tenants: number; // distinct owners who asked
  exampleTask: string | null;
  spec: unknown | null; // latest non-null drop-in spec
  firstSeen: string;
  lastSeen: string;
}

export const listAllCapabilityRequests = async (): Promise<CapabilityRequestSummary[]> => {
  const rows = await prisma.roadmapDemand.findMany({
    where: { action: 'requested' },
    orderBy: { createdAt: 'desc' },
  });
  const byCap = new Map<string, { rows: RoadmapDemand[]; owners: Set<string> }>();
  for (const r of rows) {
    const g = byCap.get(r.agentId) ?? { rows: [], owners: new Set<string>() };
    g.rows.push(r);
    g.owners.add(r.ownerId);
    byCap.set(r.agentId, g);
  }
  return [...byCap.entries()]
    .map(([capabilityId, g]) => {
      const spec = g.rows.find((r) => r.spec != null)?.spec ?? null;
      const example = (spec as { exampleTask?: string } | null)?.exampleTask ?? null;
      const times = g.rows.map((r) => r.createdAt.getTime());
      return {
        capabilityId,
        requests: g.rows.length,
        tenants: g.owners.size,
        exampleTask: example,
        spec,
        firstSeen: new Date(Math.min(...times)).toISOString(),
        lastSeen: new Date(Math.max(...times)).toISOString(),
      };
    })
    .sort((a, b) => b.requests - a.requests);
};
