// Kill switch (Atria Phase 03 safety layer) — a runtime-toggleable GLOBAL pause on all external
// actions (publishes / outbound writes). When ON, the connector runtime refuses every external
// action so nothing goes out platform-wide (the ops "stop everything" button). Backed by the
// SystemFlag table so it survives restarts and is auditable. Run-level ABORT is separate (a run
// status → 'aborted' the executor honors between nodes); this is the system-wide switch.
import { prisma } from '../db/client.ts';
import { logger } from '../lib/logger.ts';

export const EXTERNAL_ACTIONS_PAUSED = 'external_actions_paused';

// Tiny in-process cache so the hot publish path doesn't hit the DB on every action. A few
// seconds of staleness is fine for a safety pause (worst case: a couple of in-flight actions
// slip through right after toggling ON — the run-level gates + idempotency still apply).
let cache: { value: boolean; at: number } | null = null;
const TTL_MS = 3_000;
// Date.now() is unavailable in some sandboxed contexts but fine in the server runtime.
const now = (): number => Date.now();

export const isExternalActionsPaused = async (): Promise<boolean> => {
  if (cache && now() - cache.at < TTL_MS) return cache.value;
  try {
    const flag = await prisma.systemFlag.findUnique({ where: { key: EXTERNAL_ACTIONS_PAUSED } });
    const value = flag?.enabled ?? false;
    cache = { value, at: now() };
    return value;
  } catch (e) {
    // On a read fault, FAIL OPEN (don't block publishing on a DB hiccup) but log it.
    logger.warn('kill_switch_read_failed', { error: String(e).slice(0, 120) });
    return false;
  }
};

export interface KillSwitchState {
  paused: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const getKillSwitch = async (): Promise<KillSwitchState> => {
  const flag = await prisma.systemFlag.findUnique({ where: { key: EXTERNAL_ACTIONS_PAUSED } });
  return {
    paused: flag?.enabled ?? false,
    updatedAt: flag?.updatedAt ? flag.updatedAt.toISOString() : null,
    updatedBy: flag?.updatedBy ?? null,
  };
};

// Toggle the global pause. Upserts the flag + busts the cache so the change takes effect at once.
export const setExternalActionsPaused = async (enabled: boolean, updatedBy: string): Promise<KillSwitchState> => {
  const flag = await prisma.systemFlag.upsert({
    where: { key: EXTERNAL_ACTIONS_PAUSED },
    create: { key: EXTERNAL_ACTIONS_PAUSED, enabled, updatedBy },
    update: { enabled, updatedBy },
  });
  cache = { value: enabled, at: now() };
  logger.info('kill_switch_toggled', { paused: enabled, by: updatedBy });
  return { paused: flag.enabled, updatedAt: flag.updatedAt.toISOString(), updatedBy: flag.updatedBy };
};
