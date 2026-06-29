// Connections router — read-only view of the caller's social connections (brief
// §11 "Connection Resolver returns requires_user_action" UX, demo-surfaced). It
// reads the OAuthToken store via metadata-only repo calls and NEVER touches the
// write path or exposes any token value. New platforms a user hasn't connected
// appear as `not_connected` with a Connect link to the existing OAuth flow.
import { Router } from 'express';
import { ok, asyncHandler } from './http.ts';
import { listTokenStatusForOwner, type TokenStatusRow } from '../db/repos/token-repo.ts';
import type { SocialPlatform, TokenStatus } from '../../prisma/generated/prisma/client.ts';

export const connectionsRouter: Router = Router();

// The platforms the product can connect, with display metadata + the capability
// skills each supports (mirrors the publisher's social.post.* capabilities, scoped
// to what each platform accepts). Static config — no per-request cost.
const PLATFORMS: Array<{ platformKey: SocialPlatform; displayName: string; capabilities: string[] }> = [
  { platformKey: 'facebook', displayName: 'Facebook', capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel'] },
  { platformKey: 'instagram', displayName: 'Instagram', capabilities: ['social.post.image', 'social.post.video', 'social.post.carousel'] },
  { platformKey: 'threads', displayName: 'Threads', capabilities: ['social.post.image', 'social.post.video'] },
  { platformKey: 'linkedin', displayName: 'LinkedIn', capabilities: ['social.post.image', 'social.post.video'] },
  { platformKey: 'x', displayName: 'X', capabilities: ['social.post.image', 'social.post.video'] },
];

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
}

connectionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows: TokenStatusRow[] = await listTokenStatusForOwner(req.userId!);
    const byPlatform = new Map(rows.map((r) => [r.platform, r]));
    const data: ConnectionDto[] = PLATFORMS.map((p) => {
      const row = byPlatform.get(p.platformKey);
      return {
        platformKey: p.platformKey,
        displayName: p.displayName,
        state: toState(row?.status),
        expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : null,
        lastCheckedAt: row?.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
        capabilities: p.capabilities,
        connectUrl: `/connect/${p.platformKey}/start`,
      };
    });
    ok(res, data, { count: data.length, nextCursor: null });
  }),
);
