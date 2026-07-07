// Roadmap-demand repo (Atria Phase 06). Owner-scoped append-only log of roadmap-agent pitches +
// accepts — the real per-tenant demand signal for what to build next. No PII (agent id + signal label).
import { prisma } from '../client.ts';
import type { RoadmapDemand } from '../../../prisma/generated/prisma/client.ts';

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
