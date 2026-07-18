// The platform a plan falls back to when the user named none.
//
// This was the bare literal `['facebook']` repeated across 6 production files / 8 call sites
// (intake-provider, campaigns-router, orchestration-router, agent-runners ×3, campaign-from-flow,
// campaign-materializer). Changing the default meant editing all eight, and missing one would
// silently diverge the campaign path from the run path. Hoisted here so there is one place.
//
// Scope: this is a DRY fix only — same value, same behaviour. It does NOT address the deeper
// issue, which is that falling back to a FIXED platform is the wrong semantics: a tenant who has
// connected only Instagram still gets a Facebook-targeted plan, then hits the connection gate and
// is told to connect an account they never wanted. The right fallback is the tenant's first
// CONNECTED platform. That is a behaviour change and needs its own verify script — see
// docs/product/06-technical-debt-and-improvements.md §3.4b.
//
// Not blast-radius-free to change casually: `verify-campaign-platform-inherit-http` asserts the
// literal fallback ("no-flow campaign falls back to facebook"), and the planner golden fixtures
// pass platforms explicitly so they are unaffected.
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

export const DEFAULT_PLATFORMS: SocialPlatform[] = ['facebook'];

// Callers mostly need "what they picked, or the default" — keep that shape in one place too so the
// `x.length ? x : DEFAULT_PLATFORMS` ternary does not get re-typed eight times.
export const platformsOrDefault = (picked: readonly SocialPlatform[] | undefined): SocialPlatform[] =>
  picked && picked.length ? [...picked] : [...DEFAULT_PLATFORMS];
