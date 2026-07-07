// Stateless two-step confirmation token for the Atria autonomy grant (Phase 01).
//
// Backend-enforced double-confirm: flipping a run to autonomous mode must never happen in a
// SINGLE call. Step 1 (no token) issues a confirmationToken; step 2 must echo it back. Because
// the token is an HMAC keyed on a server secret, a caller cannot forge it — it can only be
// obtained from an authenticated step-1 call, so a lone stray/malicious request can't grant.
//
// Stateless (HMAC, no store) so it survives restarts and needs no cache infra. Scoped to
// (runId, ownerId): a token for one run can't confirm another, and can't cross tenants.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.ts';

// Falls back to a fixed dev string when JWT_SECRET is unset (scaffold boots with empty secret).
// In production JWT_SECRET is required, so the key is real there.
const key = (): string => env.JWT_SECRET || 'atria-grant-dev-secret';

export const issueGrantToken = (runId: string, ownerId: string): string =>
  createHmac('sha256', key()).update(`atria-grant:${runId}:${ownerId}`).digest('hex');

export const verifyGrantToken = (runId: string, ownerId: string, token: unknown): boolean => {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = issueGrantToken(runId, ownerId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Campaign-scoped variant (Atria Phase 05): one double-confirm authorizes EVERY materialized post's
// run in the campaign. Distinct prefix so a run token can't confirm a campaign grant (or vice-versa),
// and scoped to (campaignId, ownerId) so it can't cross campaigns or tenants.
export const issueCampaignGrantToken = (campaignId: string, ownerId: string): string =>
  createHmac('sha256', key()).update(`atria-campaign-grant:${campaignId}:${ownerId}`).digest('hex');

export const verifyCampaignGrantToken = (campaignId: string, ownerId: string, token: unknown): boolean => {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = issueCampaignGrantToken(campaignId, ownerId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
