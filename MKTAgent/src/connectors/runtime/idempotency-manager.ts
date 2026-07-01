// Idempotency manager (brief §11.15). Prevents a retried/duplicated external write from
// posting twice. NO NEW TABLE: it reuses the external_action_audit_log, which already
// persists detail.idempotencyKey + status + externalId for every real attempt. A prior
// `ok` row for the same (ownerId, idempotencyKey) means "already published" → the runtime
// short-circuits and returns that externalId instead of calling the platform again.
//
// Durable across process restarts (it's a DB read), owner-scoped (no cross-tenant reuse),
// and only ever dedupes SUCCESSES — a prior `error` row does not block a genuine retry.
import { prisma } from '../../db/client.ts';
import { logger } from '../../lib/logger.ts';

export interface PriorSuccess {
  externalId: string | null;
  platform: string;
  actionKey: string;
}

// Look up a prior successful external action for this idempotency key. Returns the
// cached success (to short-circuit) or null (first time / only-failed-before → proceed).
// Best-effort: a lookup fault must not block the action, so it returns null on error.
export const findPriorSuccess = async (
  ownerId: string,
  idempotencyKey: string,
): Promise<PriorSuccess | null> => {
  try {
    const row = await prisma.externalActionAuditLog.findFirst({
      where: {
        ownerId,
        status: 'ok',
        detail: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true, platform: true, actionKey: true },
    });
    return row ?? null;
  } catch (e) {
    logger.warn('idempotency_lookup_failed', { ownerId, error: String(e instanceof Error ? e.message : e) });
    return null;
  }
};

// Derive a stable idempotency key for a publish. Same post + platform + asset type =>
// same key => a retry is deduped. Callers that don't set a key opt out of dedupe.
export const publishIdempotencyKey = (postId: string, platform: string, assetType: string): string =>
  `pub:${postId}:${platform}:${assetType}`;
