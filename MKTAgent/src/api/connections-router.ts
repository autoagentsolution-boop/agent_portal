// Connections router — read-only view of the caller's social connections (brief
// §11 "Connection Resolver returns requires_user_action" UX, demo-surfaced). It
// reads the OAuthToken store via metadata-only repo calls and NEVER touches the
// write path or exposes any token value. New platforms a user hasn't connected
// appear as `not_connected` with a Connect link to the existing OAuth flow.
import { Router } from 'express';
import { ok, asyncHandler } from './http.ts';
import { listTokenStatusForOwner, type TokenStatusRow } from '../db/repos/token-repo.ts';
import { listPublisherPlatformTokenKeys, platformTokenKey } from '../db/repos/agent-credential-repo.ts';
import { hasDriveConnected } from '../assets/drive-client.ts';
import { isOAuthConfigured } from '../social/connect-providers.ts';
import { CONNECTORS, connectStartPath } from '../connectors/registry/connector-registry.ts';
import type { SocialPlatform, TokenStatus } from '../../prisma/generated/prisma/client.ts';

export const connectionsRouter: Router = Router();

// UI-facing connection state. `not_connected` = no token row; otherwise derived
// from the token's liveness status maintained by the token cron.
export type ConnectionState = 'connected' | 'needs_attention' | 'not_connected';

const toState = (status: TokenStatus | undefined): ConnectionState => {
  if (!status) return 'not_connected';
  if (status === 'active') return 'connected';
  return 'needs_attention'; // needs_attention | revoked → user action required
};

interface ConnectionDto {
  platformKey: SocialPlatform;
  displayName: string;
  state: ConnectionState;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  capabilities: string[];
  connectUrl: string;
  // Is the OAuth app configured for one-click Connect? false → UI guides the owner to
  // set the app up (or use the paste-a-token fallback).
  oauthConfigured: boolean;
}

connectionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows: TokenStatusRow[] = await listTokenStatusForOwner(req.userId!);
    const byPlatform = new Map(rows.map((r) => [r.platform, r]));
    // A form-entered access token (vault) also counts as connected, even without an
    // OAuthToken row — so the OAuth-less publish path shows the right state + passes preflight.
    const formKeys = await listPublisherPlatformTokenKeys(req.userId!);
    const data: ConnectionDto[] = await Promise.all(
      CONNECTORS.map(async (p) => {
        const row = byPlatform.get(p.platformKey);
        const hasFormToken = formKeys.has(platformTokenKey(p.platformKey));
        // A verified token (OAuth or a liveness-checked paste) has a token-status row → its
        // real status wins. A bare vault token with NO status row = pasted but never verified
        // (legacy) → needs_attention, NOT a false "connected". Nothing at all → not_connected.
        const state = row?.status ? toState(row.status) : hasFormToken ? 'needs_attention' : 'not_connected';
        return {
          platformKey: p.platformKey,
          displayName: p.displayName,
          state,
          expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : null,
          lastCheckedAt: row?.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
          capabilities: p.capabilities,
          connectUrl: connectStartPath(p.platformKey),
          oauthConfigured: await isOAuthConfigured(p.platformKey, req.userId!),
        };
      }),
    );
    ok(res, data, { count: data.length, nextCursor: null });
  }),
);

// Media storage targets. Drive is NOT a SocialPlatform (own connect route family), so its
// connected state — presence of the per-user Drive refresh token in the vault — is reported
// here, separate from the social connections list. Local is always active.
connectionsRouter.get(
  '/storage',
  asyncHandler(async (req, res) => {
    const driveConnected = await hasDriveConnected(req.userId!);
    ok(res, {
      local: { connected: true },
      drive: { connected: driveConnected, connectPath: '/connect/drive/start' },
    });
  }),
);
