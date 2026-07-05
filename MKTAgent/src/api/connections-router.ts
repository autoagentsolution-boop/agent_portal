// Connections router — read-only view of the caller's social connections (brief
// §11 "Connection Resolver returns requires_user_action" UX, demo-surfaced). It
// reads the OAuthToken store via metadata-only repo calls and NEVER touches the
// write path or exposes any token value. New platforms a user hasn't connected
// appear as `not_connected` with a Connect link to the existing OAuth flow.
import { Router } from 'express';
import { ok, asyncHandler } from './http.ts';
import { resolveConnectionStates, type ConnectionState } from './connection-state.ts';
import { hasDriveConnected } from '../assets/drive-client.ts';
import { isOAuthConfigured } from '../social/connect-providers.ts';
import { CONNECTORS, connectStartPath } from '../connectors/registry/connector-registry.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

export const connectionsRouter: Router = Router();

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
    const conn = await resolveConnectionStates(req.userId!);
    const data: ConnectionDto[] = await Promise.all(
      CONNECTORS.map(async (p) => {
        const c = conn(p.platformKey);
        return {
          platformKey: p.platformKey,
          displayName: p.displayName,
          state: c.state,
          expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
          lastCheckedAt: c.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
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
