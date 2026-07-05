// Owner→platform connection state, extracted so BOTH the connections list and the
// per-post publish review (item 3) derive "connected / needs_attention / not_connected"
// the same way. A verified token (OAuth or a liveness-checked paste) has a status row →
// its real status wins. A bare vault token with no status row = pasted-but-unverified →
// needs_attention. Nothing → not_connected. Metadata only; never reads a token value.
import { listTokenStatusForOwner } from '../db/repos/token-repo.ts';
import { listPublisherPlatformTokenKeys, platformTokenKey } from '../db/repos/agent-credential-repo.ts';
import type { SocialPlatform, TokenStatus } from '../../prisma/generated/prisma/client.ts';

export type ConnectionState = 'connected' | 'needs_attention' | 'not_connected';

export interface OwnerConnectionInfo {
  state: ConnectionState;
  expiresAt: Date | null;
  lastCheckedAt: Date | null;
}

const toState = (status: TokenStatus | undefined): ConnectionState => {
  if (!status) return 'not_connected';
  if (status === 'active') return 'connected';
  return 'needs_attention'; // needs_attention | revoked → user action required
};

// Returns a synchronous resolver over the owner's connections (two DB reads up front,
// then O(1) per platform). Callers map it over whatever platform set they care about.
export const resolveConnectionStates = async (
  ownerId: string,
): Promise<(platform: SocialPlatform) => OwnerConnectionInfo> => {
  const rows = await listTokenStatusForOwner(ownerId);
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  const formKeys = await listPublisherPlatformTokenKeys(ownerId);
  return (platform) => {
    const row = byPlatform.get(platform);
    const state = row?.status
      ? toState(row.status)
      : formKeys.has(platformTokenKey(platform))
        ? 'needs_attention'
        : 'not_connected';
    return { state, expiresAt: row?.expiresAt ?? null, lastCheckedAt: row?.lastCheckedAt ?? null };
  };
};
