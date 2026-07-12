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
