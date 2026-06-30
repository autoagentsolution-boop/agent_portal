// Connection Resolver (brief §11.6/11.11) — the pre-execution gate. Given a planned
// run, it decides whether every agent that `requiresConnection` has a live connection
// for the run's target platforms BEFORE the DAG executes. A missing/stale connection
// returns a `requires_user_action` result so the run can stop at $0 spent instead of
// dying after the (paid) image-gen step.
//
// Pure + injectable: the token-status reader is a parameter (default = real repo) so
// the verify script exercises every branch with no DB. The resolver reads token
// METADATA only (status/expiry) — never a token value (secrecy stays in the vault layer).
import type { SocialPlatform, TokenStatus } from '../../../prisma/generated/prisma/client.ts';
import type { GoalSpec } from '../../orchestration/schemas/goal-spec.ts';
import type { WorkflowPlan } from '../../orchestration/schemas/workflow-plan.ts';
import { getAgent } from '../../orchestration/registry/agent-registry.ts';
import { getConnector, connectStartPath } from '../registry/connector-registry.ts';
import { listTokenStatusForOwner } from '../../db/repos/token-repo.ts';

// One platform the user must act on before the run can proceed.
export interface RequiredAction {
  type: 'connect_platform' | 'reconnect_platform';
  platform: SocialPlatform;
  displayName: string;
  connectUrl: string;
  reason: string;
  capabilities: string[];
}

export type ConnectionResolution =
  | { status: 'resolved' }
  | { status: 'missing_connection' | 'needs_attention'; required: RequiredAction[] };

// Metadata-only token row (matches token-repo's TokenStatusRow). Injected so tests
// don't touch the DB.
export interface TokenStatusLike {
  platform: SocialPlatform;
  status: TokenStatus;
  expiresAt: Date | null;
}
export type TokenStatusReader = (ownerId: string) => Promise<TokenStatusLike[]>;

// Per-platform liveness, derived from the token row. `connected` only when a row
// exists, status=active, and it isn't past expiry.
type Liveness = 'connected' | 'needs_attention' | 'not_connected';

const livenessOf = (row: TokenStatusLike | undefined, now: Date): Liveness => {
  if (!row) return 'not_connected';
  if (row.status !== 'active') return 'needs_attention'; // needs_attention | revoked
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'needs_attention'; // expired
  return 'connected';
};

// True if a connected agent (one capability of its set) is fulfillable by the
// platform's connector — i.e. the platform accepts at least one of those capabilities.
// Guards against requiring a connection a platform can't even satisfy.
const connectorSupports = (platform: SocialPlatform, agentCaps: string[]): boolean => {
  const conn = getConnector(platform);
  if (!conn) return false;
  return agentCaps.some((c) => conn.capabilities.includes(c));
};

export const resolveConnections = async (
  ownerId: string,
  goal: GoalSpec,
  plan: WorkflowPlan,
  reader: TokenStatusReader = listTokenStatusForOwner,
): Promise<ConnectionResolution> => {
  // Capabilities required by any connection-needing agent in this plan. Empty set =>
  // no external-write agent => nothing to resolve.
  const requiredCaps = new Set<string>();
  for (const node of plan.nodes) {
    const def = getAgent(node.agentId);
    if (def?.requiresConnection && def.capabilities?.length) {
      for (const c of def.capabilities) requiredCaps.add(c);
    }
  }
  if (requiredCaps.size === 0) return { status: 'resolved' };

  const caps = [...requiredCaps];
  const targets = goal.platforms.filter((p) => connectorSupports(p, caps));
  if (targets.length === 0) return { status: 'resolved' };

  const now = new Date();
  const rows = await reader(ownerId);
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));

  const required: RequiredAction[] = [];
  for (const platform of targets) {
    const conn = getConnector(platform)!;
    const liveness = livenessOf(byPlatform.get(platform), now);
    if (liveness === 'connected') continue;
    required.push({
      type: liveness === 'not_connected' ? 'connect_platform' : 'reconnect_platform',
      platform,
      displayName: conn.displayName,
      connectUrl: connectStartPath(platform),
      reason:
        liveness === 'not_connected'
          ? `Connect ${conn.displayName} so the agent can publish on your behalf.`
          : `Reconnect ${conn.displayName} — its authorization expired or was revoked.`,
      capabilities: conn.capabilities.filter((c) => caps.includes(c)),
    });
  }

  if (required.length === 0) return { status: 'resolved' };
  // If every gap is a stale (not missing) connection, surface as needs_attention so
  // the UI can phrase it as "reconnect" rather than "connect".
  const allStale = required.every((r) => r.type === 'reconnect_platform');
  return { status: allStale ? 'needs_attention' : 'missing_connection', required };
};
