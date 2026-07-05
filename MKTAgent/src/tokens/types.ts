// Token lifecycle types. Each platform declares how its token is checked and
// (optionally) refreshed. The refresh cron walks the registry generically.
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

export interface TokenCheckResult {
  alive: boolean;
  // human-readable identity confirmed by the liveness call (page name, username)
  identity?: string;
  reason?: string;
}

export interface RefreshResult {
  // new plaintext token (caller encrypts + persists)
  token: string;
  expiresAt: Date | null;
  refreshToken?: string | null;
}

export interface PlatformTokenProvider {
  platform: SocialPlatform;
  // Liveness probe (cheap GET). Always implemented.
  check(token: string, meta: Record<string, unknown> | null): Promise<TokenCheckResult>;
  // Refresh ahead of expiry. Undefined = never-expire (FB/IG page tokens) → no-op.
  // ownerId lets a provider resolve per-user app creds (X/LinkedIn client id+secret)
  // from the vault; env-only providers ignore it.
  refresh?: (
    token: string,
    refreshToken: string | null,
    meta: Record<string, unknown> | null,
    ownerId?: string,
  ) => Promise<RefreshResult>;
  // Refresh when remaining lifetime drops below this. Ignored if no refresh().
  refreshWhenWithinMs?: number;
}

export const DAY_MS = 24 * 3600 * 1000;
