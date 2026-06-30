// External-action audit log writer (brief §11.13). One append-only row per outward
// action the Connector Runtime performs. The writer is the LAST line of secrecy
// defense: `detail` is whitelisted to safe keys, so even if a caller passed a token
// in the metadata it would not be persisted. Audit failures NEVER block the action
// (best-effort: a logging fault must not stop a publish or surface to the user).
import { prisma } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';

export interface AuditEntry {
  ownerId: string;
  runId?: string | null;
  nodeId?: string | null;
  platform: string;
  actionKey: string;
  status: 'ok' | 'error';
  externalId?: string | null;
  error?: string | null;
  // Free-form context; redacted to a safe-key whitelist before write.
  detail?: Record<string, unknown> | null;
}

// Keys allowed into the persisted `detail`. Anything else (token, access_token,
// secret, authorization, refresh_token, …) is dropped — defense in depth even though
// the runtime never puts secrets here in the first place.
const SAFE_DETAIL_KEYS = new Set(['postId', 'assetType', 'platform', 'actionKey', 'idempotencyKey', 'durationMs']);

// Whitelisted keys must be SCALARS — objects/arrays (which could nest a secret) and
// undefined (a noisy absent value) are dropped; only present primitives survive.
export const redactDetail = (detail: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  if (!detail) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SAFE_DETAIL_KEYS.has(k) && v !== undefined && typeof v !== 'object') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
};

export const recordExternalAction = async (entry: AuditEntry): Promise<void> => {
  try {
    await prisma.externalActionAuditLog.create({
      data: {
        ownerId: entry.ownerId,
        runId: entry.runId ?? null,
        nodeId: entry.nodeId ?? null,
        platform: entry.platform,
        actionKey: entry.actionKey,
        status: entry.status,
        externalId: entry.externalId ?? null,
        error: entry.error ?? null,
        detail: (redactDetail(entry.detail) ?? undefined) as object | undefined,
      },
    });
  } catch (e) {
    // Audit is best-effort — never block or fail the action it describes.
    logger.error('external_audit_write_failed', { platform: entry.platform, actionKey: entry.actionKey, error: String(e instanceof Error ? e.message : e) });
  }
};
