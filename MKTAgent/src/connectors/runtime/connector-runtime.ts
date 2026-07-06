// Connector Runtime (brief §11.7) — the single chokepoint through which agents reach
// an external platform. An agent declares a capability; the runtime maps it to a
// connector action, validates the input against the registry, invokes the underlying
// adapter, and returns a structured, redacted result. The runtime — NOT the agent —
// holds the connection; the LLM never sees a token (the adapter loads it from the
// vault internally via getActiveToken).
//
// WRAP, DON'T REWRITE: the five social/* adapters are untouched. `invokeAction`
// delegates to the existing `publishTo`, and exposes an `asPublishFn()` shim so it can
// be injected as the executor's PublishFn and sit in the live path with `publishTo`
// preserved as the fallback (brief §11.16).
import { publishTo } from '../../social/index.ts';
import { getConnector, getConnectorAction } from '../registry/connector-registry.ts';
import { recordExternalAction } from '../audit/external-action-audit-log.ts';
import { isExternalActionsPaused } from '../../system/kill-switch.ts';
import { findPriorSuccess, publishIdempotencyKey } from './idempotency-manager.ts';
import { acquireSlot } from './rate-limit-manager.ts';
import { withRetry } from '../../lib/retry.ts';
import { logger } from '../../lib/logger.ts';
import type { PublishInput, PublishResult } from '../../social/types.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

export interface InvokeActionArgs {
  ownerId: string;
  platform: SocialPlatform;
  // Capability skill, e.g. 'social.post.image'. Resolved to a connector action.
  actionKey: string;
  input: PublishInput;
  // Optional idempotency key (§11.15). When set, a prior successful audit row for the
  // same (ownerId, key) short-circuits — the action is NOT re-sent to the platform.
  idempotencyKey?: string;
}

export interface InvokeResult {
  ok: boolean;
  platform: SocialPlatform;
  actionKey: string;
  externalId: string | null; // the published URL/id, when ok
  error: string | null;
}

// Map a PublishResult (adapter shape) → InvokeResult (runtime shape). url is the
// external id we surface; everything else is structured + safe to log.
const toInvokeResult = (platform: SocialPlatform, actionKey: string, r: PublishResult): InvokeResult => ({
  ok: r.ok,
  platform,
  actionKey,
  externalId: r.url,
  error: r.error,
});

// Invoke one connector action for one platform. Never throws — validation and adapter
// failures become a structured `ok:false` result so the caller's aggregation stays
// uniform (matches the publishTo contract).
export const invokeAction = async (args: InvokeActionArgs): Promise<InvokeResult> => {
  const { ownerId, platform, actionKey, input } = args;
  const connector = getConnector(platform);
  if (!connector) {
    return { ok: false, platform, actionKey, externalId: null, error: `no connector for ${platform}` };
  }
  const action = getConnectorAction(platform, actionKey);
  if (!action) {
    return { ok: false, platform, actionKey, externalId: null, error: `${platform} does not support ${actionKey}` };
  }

  // Kill switch (Phase 03 safety): a GLOBAL pause blocks EVERY external action platform-wide —
  // checked FIRST (before input validation) so a paused system refuses everything, and audited so
  // ops sees exactly what was held. A DRY-RUN publish never reaches here (it bypasses the runtime).
  if (await isExternalActionsPaused()) {
    await recordExternalAction({ ownerId, platform, actionKey, status: 'error', error: 'external_actions_paused', detail: { killSwitch: true } }).catch(() => {});
    logger.warn('connector_paused_by_kill_switch', { ownerId, platform, actionKey });
    return { ok: false, platform, actionKey, externalId: null, error: 'external_actions_paused' };
  }
  // Validate required inputs are present before spending a network call (§11.4).
  const missing = action.requiredInputs.filter((k) => {
    const v = (input as unknown as Record<string, unknown>)[k];
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === '';
  });
  if (missing.length) {
    return { ok: false, platform, actionKey, externalId: null, error: `missing required input(s): ${missing.join(', ')}` };
  }

  // Idempotency (§11.15): if this exact action already succeeded, return the cached
  // externalId — never post twice. Owner-scoped, durable (audit-log backed).
  if (args.idempotencyKey) {
    const prior = await findPriorSuccess(ownerId, args.idempotencyKey);
    if (prior) {
      logger.info('connector_idempotent_hit', { ownerId, platform, actionKey, idempotencyKey: args.idempotencyKey });
      return { ok: true, platform, actionKey, externalId: prior.externalId, error: null };
    }
  }

  // Rate-limit (§11.15): space bursts per owner+platform before the network call.
  await acquireSlot(ownerId, platform);

  logger.info('connector_invoke', { ownerId, platform, actionKey, postId: input.postId });
  // Retry (§11.15): the adapter swallows most failures into ok:false (no throw), so
  // withRetry mainly guards against genuine transport throws — a documented seam. It does
  // NOT retry an ok:false result (that's a semantic failure, not a transient fault).
  const result = await withRetry(() => publishTo(platform, input), { label: `publish:${platform}`, attempts: 3 });
  const invoked = toInvokeResult(platform, actionKey, result);

  // Audit every REAL external attempt (§11.13) — after the network call, with redacted
  // detail. DECISION: the pre-network rejections above (unknown platform / unsupported
  // action / missing input) are NOT audited — the audit log records what we SENT to a
  // platform, not what was rejected before any external contact. Malformed-input probing
  // still surfaces via the logger, not the forensic action log.
  await recordExternalAction({
    ownerId,
    platform,
    actionKey,
    status: invoked.ok ? 'ok' : 'error',
    externalId: invoked.externalId,
    error: invoked.error,
    detail: { postId: input.postId, assetType: input.assetType, idempotencyKey: args.idempotencyKey },
  });

  return invoked;
};

// Derive the action key for a post from its asset type — the publisher fans one post
// out to many platforms, and the capability is the same per asset type.
const ACTION_BY_ASSET: Record<string, string> = {
  image: 'social.post.image',
  video: 'social.post.video',
  carousel: 'social.post.carousel',
};
export const actionKeyForAsset = (assetType: string): string =>
  ACTION_BY_ASSET[assetType] ?? 'social.post.image';

// Adapter shim: expose the runtime as a PublishFn (platform, input) → PublishResult so
// it can be injected as the executor's publishFn. The publisher runner stays unchanged;
// the runtime simply becomes the path it travels (with publishTo as the fallback inside).
export const runtimePublishFn = async (
  platform: SocialPlatform,
  input: PublishInput,
): Promise<PublishResult> => {
  const res = await invokeAction({
    ownerId: input.ownerId,
    platform,
    actionKey: actionKeyForAsset(input.assetType),
    input,
    idempotencyKey: publishIdempotencyKey(input.postId, platform, input.assetType),
  });
  return { platform, ok: res.ok, url: res.externalId, error: res.error };
};
