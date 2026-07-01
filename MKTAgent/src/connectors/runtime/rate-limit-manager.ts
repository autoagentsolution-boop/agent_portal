// Rate-limit manager (brief §11.15). Enforces a minimum spacing between external writes
// per (ownerId, platform) so a burst of publishes can't trip a platform's anti-spam
// guard (the Meta 24-48h ban we've hit before). Serializes per key: each acquire() waits
// until at least MIN_INTERVAL_MS after the previous slot for that key, then claims the
// next slot.
//
// SCOPE (honest limits): in-memory + single-process. It smooths bursts within ONE server
// instance; it is NOT a distributed limiter. Multi-instance deploys need a shared store
// (Redis) — deferred, since the demo runs one process and publishing is DRY. State is a
// Map keyed by owner:platform; entries are tiny (one timestamp) and self-refresh.
import { logger } from '../../lib/logger.ts';

// Default minimum gap between two writes to the same platform for one owner.
const DEFAULT_MIN_INTERVAL_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// nextAllowedAt[key] = the earliest epoch-ms the next slot may run. Advancing it while
// holding the synchronous section makes concurrent acquires queue deterministically.
const nextAllowedAt = new Map<string, number>();

const keyOf = (ownerId: string, platform: string): string => `${ownerId}:${platform}`;

export interface RateLimitOptions {
  minIntervalMs?: number;
}

// Wait for (and claim) the next send slot for this owner+platform. Resolves once the
// caller may proceed. Concurrent callers for the same key are spaced minIntervalMs apart.
export const acquireSlot = async (
  ownerId: string,
  platform: string,
  opts: RateLimitOptions = {},
): Promise<void> => {
  const interval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const key = keyOf(ownerId, platform);
  const now = Date.now();
  const earliest = nextAllowedAt.get(key) ?? 0;
  const slot = Math.max(now, earliest);
  // Reserve the slot AFTER this one synchronously, before awaiting, so a parallel
  // acquire sees the reservation and queues behind it (no thundering herd).
  nextAllowedAt.set(key, slot + interval);
  const waitMs = slot - now;
  if (waitMs > 0) {
    logger.info('rate_limit_wait', { ownerId, platform, waitMs });
    await sleep(waitMs);
  }
};

// Test/support hook: clear all reservations (used by verify scripts to avoid cross-test
// bleed). Not called in the request path.
export const resetRateLimits = (): void => nextAllowedAt.clear();
