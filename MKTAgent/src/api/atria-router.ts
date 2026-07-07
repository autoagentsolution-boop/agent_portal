// Atria router (Phase 06) — proactive suggestions + roadmap pitches. GET /atria/suggestions returns
// the ranked, explainable nudges derived from the tenant's own history (no PII); surfacing a roadmap
// pitch logs it once as demand (and won't nag again). Accepting a pitch logs it as accepted demand.
// NOTHING runs from here — accepting a campaign suggestion prefills the Phase-03 flow the user then
// reviews + grants. Tenant-scoped via requireAuth.
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { readSignals } from '../orchestration/atria/signal-reader.ts';
import { suggestFor } from '../orchestration/atria/atria-suggestions.ts';
import { ROADMAP_AGENTS, getRoadmapAgent } from '../orchestration/registry/roadmap-agents.ts';
import { logRoadmapDemand, wasPitched } from '../db/repos/roadmap-demand-repo.ts';

export const atriaRouter: Router = Router();

// The roadmap Atria knows about (UI reference for the pitch cards).
atriaRouter.get('/roadmap', (_req, res) => ok(res, ROADMAP_AGENTS));

// Ranked proactive suggestions. A roadmap pitch is logged once (demand) and then suppressed on
// later polls so Atria doesn't nag; campaign suggestions always surface while their signal holds.
atriaRouter.get('/suggestions', asyncHandler(async (req, res) => {
  const signals = await readSignals(req.userId!);
  const all = suggestFor(signals);
  const surfaced = [];
  for (const s of all) {
    const agentId = s.prefill.roadmapAgentId;
    if (agentId) {
      if (await wasPitched(req.userId!, agentId)) continue; // already pitched → don't nag
      await logRoadmapDemand(req.userId!, agentId, 'pitched', s.kind);
    }
    surfaced.push(s);
  }
  ok(res, surfaced, { count: surfaced.length });
}));

// Accept a roadmap pitch → log it as demand (the team's prioritization signal). No agent runs.
const acceptBody = z.object({ agentId: z.string().min(1).max(60) }).strict();
atriaRouter.post('/roadmap-demand', asyncHandler(async (req, res) => {
  const body = parseOr422(res, acceptBody, req.body ?? {});
  if (!body) return;
  if (!getRoadmapAgent(body.agentId)) return fail(res, 404, 'roadmap_agent_not_found');
  await logRoadmapDemand(req.userId!, body.agentId, 'accepted');
  res.status(201);
  ok(res, { ok: true });
}));
