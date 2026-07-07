# Phase 06 — Connection / Credential Hardening  [H5, M4, M5]

**Priority:** HIGH. **Status:** planned. **Depends on:** Phase 02 (boundary re-resolve consumes this).
**Findings:** E#4, E#5, E-notes. Report: connect-credential (`review-260707-1828-connect-credential.md`).

## Defects
1. **H5/E#4 — pre-DAG gate over-trusts unverified pasted tokens.** `connection-resolver.ts` treats a bare form credential (no `OAuthToken` row, never liveness-verified) as synthetic `active` → gate passes; but `connection-state.ts` marks the SAME token `needs_attention`. The two surfaces DISAGREE → autonomy spends the full media budget on a possibly-dead token.
2. **E-note — `getActiveToken` uses stale tokens.** It only excludes `revoked` — a `needs_attention`/expired token is still returned and used to publish.
3. **E-note — gate reads `goal.platforms` but publish uses `post.platforms`.** A platform added at the post level after the gate is never connection-checked. (Also addressed at the boundary in Phase 02; fix the source here.)
4. **M5/E-note — token refresh coverage.** `ENABLE_TOKEN_CRON` defaults OFF → gate reads stale liveness; LinkedIn has no refresh_token on common tiers → silent ~60d expiry; some platforms never auto-refresh.
5. **M4/E#5 — identity-id env fallback → wrong-destination publish.** `facebook.ts`/`instagram.ts` fall back to env defaults (`MKT_FB_PAGE_ID`, `MKT_IG_USER_ID`) when a tenant hasn't set a page/account id. Token is owner-scoped but the DESTINATION id is not → an autonomous post could land on the SYSTEM-default account.
6. **E-note — tokens passed as URL query params** → external-log exposure.

## Fix approach
1. **Single source of truth for connection state** — reconcile `connection-resolver.ts` and `connection-state.ts` so a credential's "is it usable" verdict is computed ONCE. A bare, never-verified pasted token must NOT read as `active` for a gate that authorizes real spend — require at least one liveness verify before it counts as connected. Both the gate and the state UI read the same function.
2. **`getActiveToken` excludes unusable states** — return only tokens that are `active` (not `needs_attention`, not expired). A stale token → treat as not-connected → gate/boundary holds (never publish on it).
3. **Gate + publish agree on the platform set** — resolve connections for the SAME platform list that will actually be published (`post.platforms` at the boundary; Phase 02). Fix the gate to not pass on `goal.platforms` alone.
4. **Token freshness for autonomy** — `ENABLE_TOKEN_CRON` ON in the autonomous deploy; document per-platform refresh capability (LinkedIn no-refresh → surface a re-auth prompt before expiry, don't silently die). Add an expiry-horizon check to the gate (token expiring within the run's expected window → hold).
5. **No env destination fallback in multi-tenant** — require a tenant-set page/account id; if absent → fail the connection gate for that platform, NEVER fall back to `MKT_FB_PAGE_ID`/`MKT_IG_USER_ID`. (Keep env only as a single-tenant/dev convenience behind a flag.)
6. **Move tokens out of URL** — pass credentials in headers/body, never query params.

## Related code files
Modify: `src/connections/connection-resolver.ts`, `src/connections/connection-state.ts` (reconcile), `src/db/repos/*token*` / `getActiveToken`, `src/social/facebook.ts` + `instagram.ts` (destination id, no env fallback), `src/social/*` (token in header not URL). Read: `src/config/env.ts` (`ENABLE_TOKEN_CRON`), token refresh cron.

## Implementation steps
1. Extract one `connectionUsable(platform, ownerId)` used by BOTH resolver and state; a never-verified pasted token is `needs_verify` (not `active`) until liveness passes.
2. `getActiveToken` → filter to usable only; callers treat unusable as not-connected.
3. Gate resolves the publish platform set; align with Phase 02 boundary.
4. Remove env destination fallback in multi-tenant path; require tenant id; gate-fail otherwise.
5. Header-based token passing.
6. Turn on token cron for autonomy + document refresh gaps (LinkedIn).
7. Verify: extend `verify-connection-resolver.ts` / `verify-connect-form.ts` — (a) bare unverified token does NOT pass the gate; (b) expired/needs_attention token is not returned by getActiveToken; (c) missing tenant page id → gate fails, no env fallback.

## Success criteria
- Gate and state UI never disagree on a token's usability.
- Autonomy never publishes on a stale/unverified token or to a system-default account.
- No secret in a URL/log.

## Security (this phase IS the security phase)
- Credential usability, destination binding, and log hygiene are the core risks for autonomous external writes. Treat "fail closed" as the default: any ambiguity → not connected → hold.

## Next steps → feeds Phase 02's boundary re-resolve.
