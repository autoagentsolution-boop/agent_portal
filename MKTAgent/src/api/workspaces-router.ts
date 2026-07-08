// Workspaces router (Atria v2 P0) — read-only view over the Workspace view-model. A "Workspace" is
// the user-facing reframe of a Campaign: a campaign room whose agents' live status + cost the hub
// (P1) renders inline. Thin wrappers; all aggregation lives in workspace-view.ts. Tenant-scoped via
// requireAuth (mounted in server.ts) → every read carries req.userId; wrong tenant → 404 (getWorkspace null).
import { Router } from 'express';
import { ok, fail, asyncHandler } from './http.ts';
import { listWorkspaces, getWorkspace } from '../orchestration/master/workspace-view.ts';

export const workspacesRouter: Router = Router();

// All of the caller's campaigns as workspace cards (status counts + cost total) for the sidebar / hub.
workspacesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await listWorkspaces(req.userId!);
    ok(res, rows, { count: rows.length });
  }),
);

// One workspace room: campaign + posts/runs + per-agent dashboard. 404 on wrong tenant / unknown id.
workspacesRouter.get(
  '/:campaignId',
  asyncHandler(async (req, res) => {
    const ws = await getWorkspace(req.params.campaignId, req.userId!);
    if (!ws) return fail(res, 404, 'workspace_not_found');
    ok(res, ws);
  }),
);
