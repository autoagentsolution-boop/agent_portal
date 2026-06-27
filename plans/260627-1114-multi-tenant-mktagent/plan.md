# Plan: MKTAgent multi-tenant + config-as-data foundation

## Context
MKTAgent (P0–P4, P6, P7-slice done) is single-tenant: one DAIS brand hardcoded in copy-gen, one
global social-token set, shared API key. User pivoted: this becomes a **multi-tenant SaaS** where
each user (1) logs in (JWT), (2) configures their own workflow (angle/length/language/platforms/
brand voice/schedule = data, not code), (3) connects their OWN social accounts, (4) sees only their
own posts/leads/status. This plan builds that foundation BEFORE finishing P5/P7-full + OpenAPI gen,
so the contract is stable and CRUD isn't built twice.

User decisions (locked):
- **Per-user social tokens NOW** (full multi-tenant token store, biggest lift).
- **Plan first**, then code.
- REST kept; **OpenAPI-generated client** for the UI (after contract stabilizes).
- **Auth = Google login (OAuth) to access the app** + **long-lived JWT access token** (NO refresh-token
  dance — user explicitly wants zero complex re-auth work). Reuse existing GOOGLE_CLIENT_ID/SECRET (already
  in env for Drive). User row created/linked on first Google login (email = identity).
- **Password hash = argon2id** (only relevant if email/password ever added; Google-login is primary so
  passwordHash is nullable/optional in v1).
- Flexibility ask = **config-as-data**: users tune angle/length/language/schedule/etc. without redeploys.
- **Language**: per-user default language setting; each post can override (use user default OR pick per post).
- **Branding optional per account type**: business = maintain brandVoice/brand data; personal = no branding
  (copy-gen runs without a brand persona). `User.accountType` (business|personal) + nullable brand fields.

## ⚠️ External constraint (gates GO-LIVE, not the code)
Per-user posting to Meta/LinkedIn/X needs **platform app-review + verification**, which DAIS's
current manual long-lived tokens bypassed:
- **Meta** (FB Pages/IG): `pages_manage_posts`, `instagram_content_publish` → Business Verification +
  App Review + public privacy policy/ToS. Weeks. IG requires an FB Page + IG Business account link.
- **Threads**: separate Threads API app + review.
- **LinkedIn**: `w_member_social` via Partner Program approval.
- **X**: write needs paid tier ($) + OAuth2 user-context with `tweet.write media.write`.
The token-store CODE + connect-flow are buildable/testable now with YOUR OWN connected accounts
(dev-mode app, self as test user). Real external onboarding waits on approvals → run in parallel.

## Architecture decisions

### 1. Tenancy model — `ownerId` root, cascade by ownership
- New `User` table: id, email (unique, = Google identity), displayName, avatarUrl, googleSub (unique),
  passwordHash (NULLABLE — Google-login primary, email/pw optional later), `accountType` (business|personal),
  `defaultLanguage` (vi|en|both), brand fields NULLABLE (brandName, brandVoice, brandContext — only for
  business; personal leaves null → copy-gen runs persona-free), role, createdAt.
- `Campaign.ownerId → User.id`. Post/Lead inherit tenancy through `campaign` (Post already has
  campaignId; Lead gets `ownerId` directly since leads aren't always campaign-bound).
- **Every repo query filters by ownerId.** No global `findMany`. Ownership is enforced in the repo
  layer (defense in depth) AND asserted in the route (JWT `sub` → ownerId).
- `MktRunLog` gets optional `ownerId` for per-tenant audit.

### 2. Config-as-data (the flexibility ask)
Three-layer inheritance: **User defaults → Campaign defaults → Post overrides** (null = inherit up).
- User gains (see §1): `defaultLanguage`, `accountType`, brand fields.
- Campaign gains: `language` (nullable → inherit user.defaultLanguage), `defaultLength`, `platforms[]`
  (default targets), `brandVoice`/`brandContext` (nullable → inherit user brand; personal accounts = null),
  `postingWindow` (e.g. "09:00-11:00" for auto-schedule), `timezone`.
- Post already has `lengthSpec`, `platforms`, `scheduledAt` → overrides; gains `language` (nullable override).
- **Resolution at copy-gen time**: `language = post.language ?? campaign.language ?? user.defaultLanguage`;
  `brandVoice = campaign.brandVoice ?? user.brandVoice ?? null` (null = personal/no-brand → persona-free prompt);
  `length = post.lengthSpec ?? campaign.defaultLength`.
- **copy-gen rewrite** (`prompt.ts`): brand persona becomes OPTIONAL. If brandVoice present → business prompt
  with that voice; if null → personal prompt (human sharing, no company persona, no #DAIS-style brand hashtags).
  `language` gates which variants emit (see §7). DAIS prompt becomes the business DEFAULT, not the only path.
  New knob later = new column + DTO field (additive, contract-safe).

### 3. Per-user token store (the heavy lift)
- `OAuthToken` PK changes `platform` → composite `(ownerId, platform)`. Migration: existing 4 DAIS
  rows get a "system/DAIS" owner so nothing breaks.
- `token-repo`, `tokens/service.ts` (`getActiveToken`, `seedTokensFromEnv`, `runTokenMaintenance`),
  ALL 5 adapters (`getActiveToken(ownerId, platform)`), scheduler tick (pass post→campaign→ownerId
  into publish), token cron (iterate all owners × platforms) → thread ownerId through.
- **Connect flow**: new `POST /connect/:platform/start` (returns platform OAuth URL) + `/connect/:platform/callback`
  (exchange code → encrypted per-user token). Replaces manual env seeding for real users. Env-seed
  path kept for DAIS/system owner + dev.

### 4. Auth — Google login + long-lived JWT
- **Flow**: `GET /auth/google/start` → Google consent URL → `GET /auth/google/callback?code=` → exchange
  code, verify Google ID token, upsert User by `googleSub`/email → issue **long-lived JWT** (HS256,
  `JWT_SECRET` env, `sub`=userId, exp ~30-90d; NO refresh token — user wants zero re-auth friction).
- Reuse existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (already in env for Drive). Add
  `GOOGLE_OAUTH_REDIRECT_URI` (dev=localhost callback; prod needs HTTPS — ties to T7/P8).
- ⚠️ **Two distinct Google scopes, do not conflate**: (a) *app login* = `openid email profile` (identity only);
  (b) *Drive asset access* = existing Drive scope. Login does NOT request Drive. Keep separate consent.
- `requireAuth` middleware (verify JWT → req.userId) replaces `requireApiKey` on user-facing routes; api-key
  kept ONLY for internal cron/webhook service-to-service.
- argon2id available for optional email/pw later (`passwordHash` nullable now; Google-login is the only v1 path).
- Per-user audit: approve/reject record `approvedBy` (userId from JWT).

### 5. Realtime — per-user scoped (SSE)
- `GET /events` (SSE, JWT-auth) streams this user's post status changes. Scheduler/copy-gen publish
  to an in-process event bus filtered by ownerId. Polling fallback (`GET /posts?status=`) always works.
  WebSocket deferred (no presence/duplex need yet).

### 6. Contract / OpenAPI
- After tenancy stable: `zod-to-openapi` → `openapi.json`; UI runs `openapi-typescript`. Envelope
  `{data,meta}|{error,details}` already proven in P7-slice. All list endpoints keyset-paginated.

## Phases (code sequential, approve between; verify each on live DB, no real social posts)

| Phase | Content | Verify |
|---|---|---|
| **T1 ✅ DONE (2026-06-27)** Users+Google-login+JWT | User model (googleSub, accountType, defaultLanguage, brand fields nullable, passwordHash nullable) + migration; auth lib (google ID-token verify via google-auth-library [already a dep], jwt sign/verify long-lived); /auth/google/start+callback+me; requireAuth middleware; JWT_SECRET + GOOGLE_OAUTH_REDIRECT_URI env | ✅ ALL PASS: upsert→JWT chain (same sub=same user, no dupe, profile refresh), 401 no/bad token / 200 valid `/auth/me`, 302→accounts.google.com identity-scope-only, callback guards 400. tsc 0. |
| **T2 ✅ DONE (2026-06-27)** Ownership | ownerId on Campaign+Lead+MktRunLog; migrate existing rows→DAIS system user; ALL repos filter by ownerId; P7-slice routes assert JWT owner; cross-tenant read → 404 | ✅ 10/10 isolation tests pass (2 seeded users): each sees only own campaigns/posts; cross-tenant GET/approve → 404 (no leak); own re-approve → 409 (state guard intact); no-token → 401. Back-fill: 0 post/campaign owner mismatches, 0 null leads, live DAIS data → system owner. tsc 0. |
| **T3 ✅ DONE (2026-06-27)** Config-as-data | Campaign config columns + DTO/schemas; Post override semantics; copy-gen prompt reads brandVoice/language/length via 3-layer resolver; persona-optional | ✅ 17/17 pass (vi/en/fr/de): 3-layer resolution (post>campaign>user); business persona vs personal persona-free; responseSchema {body,threads,x}; e2e copy-bag+language persisted; dry-tick brief→review through real service. tsc 0. |
| **T4 ✅ DONE (2026-06-27)** Per-user tokens | OAuthToken composite PK (ownerId,platform); thread ownerId through token-repo/service/5 adapters/scheduler/cron; connect-flow endpoints (start+callback) | ✅ ALL PASS: 4 DAIS rows migrated→system owner (0 orphans); adapter-path token resolves by (owner,platform); 2-owner isolation (distinct tokens, B sees only own, no cross-leak→null); connect /start URL builder valid per platform (all gated on app creds). HTTP: no-auth→401, unknown platform→404, gated→500 connect_not_configured, callback no-code→400, bad-state→400. tsc 0. |
| **T5 ✅ DONE (2026-06-27)** Realtime+OpenAPI | SSE /events per-user; event bus in scheduler/copygen; zod-to-openapi gen; finalize contract doc | ✅ ALL PASS: 2-stream isolation (A sees own post.status `ready`, B sees own, zero cross-leak both ways); SSE 401 no/bad token; openapi.json 8 paths valid 3.1.0, $refs resolve, openapi-typescript 7 compiles it. tsc 0. Test data 0 leftovers. |
| **T6 P5 leads (re-slotted)** | webhook/form/calcom + dedupe (already in lead-repo) + per-user ownerId + Gmail notify | curl webhook→Lead row scoped to owner; dup→skip; calcom parse |
| **T7 P7-full + P8 deploy** | full Campaign/Post CRUD; finish deploy (fix migrate-deploy datasource.url bug); parity vs n8n | CRUD per-tenant; container migrate+boot clean; 1 e2e post |

## New deps (T1)
- `jsonwebtoken` (+`@types/jsonwebtoken`) — pure JS, no friction.
- `argon2` — **native module**. Builds fine on Windows host (prebuilt binaries) but the Docker image
  (node:alpine) needs build tools OR the musl prebuild; verify in T1, fall back to `@node-rs/argon2`
  (Rust, prebuilt, no node-gyp) if alpine build fails. `google-auth-library` already present (via googleapis).

## Files (primary changes)
- `prisma/schema.prisma` — User model; ownerId FKs; OAuthToken composite PK; Campaign config cols.
- `src/lib/auth-jwt.ts` (new), `src/lib/password.ts` (new) — JWT + hashing.
- `src/api/auth-router.ts` (new), `src/api/middleware-auth.ts` (new).
- `src/db/repos/*` — ownerId filter on every query; `user-repo.ts` new.
- `src/copygen/prompt.ts` — read config from campaign; DEFAULT_DAIS_VOICE constant.
- `src/tokens/{service,cron}.ts` + `src/social/{5 adapters}.ts` + `src/scheduler/tick.ts` — thread ownerId.
- `src/api/connect-router.ts` (new) — per-user social OAuth connect.
- `src/api/events-router.ts` (new) — SSE.
- `src/contract/openapi.ts` (new) — zod-to-openapi.

## Verification (cross-cutting)
- Every phase: `tsc --noEmit` 0 + live-DB test (own CLI/curl), **NO real social posts** (DRY-RUN rule,
  [[feedback_no_burst_social_posts]]). Live social e2e once at T7, controlled.
- **Tenant isolation is a security boundary** — every list/get test includes a cross-tenant negative
  (user A cannot see/mutate user B's data → 404, not 403, to avoid existence leak).
- Token at-rest still AES-256-GCM, now per-owner; verify no plaintext in DB after connect.
- Migrations reversible; existing DAIS data preserved under system owner.

## Risks
- **Platform app-review latency** (Meta/LinkedIn/X) blocks real external onboarding, NOT dev/test. Build
  against own accounts; track approvals separately. Biggest schedule risk to "real users posting".
- **Token migration**: composite PK change on a table holding LIVE DAIS tokens → back up rows first;
  migrate under transaction; re-seed path exists ([[project_mktagent_backend_refactor]] ENC key note).
- **Ownership leak**: a single unfiltered query = cross-tenant data exposure. Mitigate: repo-layer
  filter as the chokepoint + negative tests every phase. Consider Prisma client extension to force ownerId.
- **Scope**: 7 phases. Re-slots P5/P7/P8 after foundation (was earlier in original plan) — intentional,
  avoids building CRUD twice.
- **JWT secret mgmt**: rotate-ability; refresh-token strategy. Decide in T1.

## Resolved (user, 2026-06-27)
- ✅ Auth: **long-lived JWT, no refresh** (user wants zero re-auth work). Google login to access app.
- ✅ Hash: **argon2id** (for optional future email/pw; Google-login primary so passwordHash nullable v1).
- ✅ Language: **per-user default**, post can override (use default OR pick per post). 3-layer resolution §2.
- ✅ App login: **Google OAuth, IN scope now** (T1). Distinct from social posting tokens + from Drive scope.
- ✅ Branding: **optional by accountType** — business keeps brand data, personal runs persona-free copy-gen.

### Language gating (T3 — `language` resolved value drives variants)
- `vi`   → emit copyVi only (copyEn/Threads/X null or skipped); FB/IG VN.
- `en`   → emit copyEn + copyThreads + copyX (all EN); copyVi null.
- `both` → emit all 4 (current behavior: copyVi VN + copyEn/Threads/X EN).
- Prompt builder branches on resolved language; responseSchema `required` adjusts so Gemini only generates
  requested variants (saves tokens + avoids empty-variant validation failures).

## T1 implementation notes (2026-06-27)
- **Plan assumption corrected**: MKTAgent's `.env` does **NOT** carry `GOOGLE_CLIENT_ID/SECRET` (this
  service reaches Drive via public lh3 URLs, not OAuth — see `src/assets/store.ts`). App-login therefore
  needs its **own** Google OAuth client provisioned (Console → OAuth consent + credentials, redirect URI
  `…/auth/google/callback`). Code fail-fasts with 500 `auth: GOOGLE_CLIENT_ID/SECRET not set` until set.
  **Blocks real Google login (not the code)** — same external-onboarding bucket as the social tokens. ☑ DONE 2026-06-27: user
  provisioned a dedicated Web OAuth client; `GOOGLE_CLIENT_ID`/`SECRET` in `MKTAgent/.env` (gitignored). Verified live: `/auth/google/start`
  → 302 accounts.google.com, scope `openid email profile` only (no Drive), redirect_uri byte-matches; guards 400/401; valid `signSession`
  JWT → `/auth/me` 200 (system owner), 60d TTL HS256. Only the interactive browser-consent leg is unexercised (needs a human at Google).
- **argon2 deferred** (YAGNI): no email/pw path in v1, `passwordHash` nullable. No native module added →
  zero Docker/alpine build risk for T1. Add `password.ts` + `@node-rs/argon2` when/if email/pw lands.
- **New files**: `src/lib/auth-jwt.ts`, `src/lib/google-oauth.ts`, `src/api/middleware-auth.ts`,
  `src/api/auth-router.ts`, `src/db/repos/user-repo.ts`, `src/db/system-owner.ts`.
- **system owner** = deterministic `00000000-0000-0000-0000-000000000001` (seeded in migration; CLI/seed
  helpers point here via `SYSTEM_OWNER_ID`). T2/T4 back-fills reference this constant.
- **JWT_SECRET** auto-generated into `.env` (48 random bytes hex). TTL `60d`, HS256, no refresh.
- Migration `20260627050657_add_user_tenancy_t1` hand-edited (create-only) to seed system user + back-fill
  the 1 live campaign before NOT NULL — reversible, live DAIS data preserved.

## T2 implementation notes (2026-06-27)
- **Post tenancy = denormalized `Post.ownerId`** (user decision, not the relation-filter plan default): flat indexed
  column copied from campaign at create time. Migration `20260627060000_add_ownership_t2` back-fills from
  `campaign.owner_id`. T4 gets owner directly off the post (`post.ownerId` → token lookup) with no join.
  ⚠ Campaign reassignment (not a v1 feature) would need a re-sync — document if/when added.
- **Enforcement = explicit repo args + negative tests** (user decision, not Prisma client extension): every
  tenant-facing repo fn takes `ownerId` as a required param; a missing one is a compile error. Greppable,
  debuggable, no hidden where-injection. Safety net = cross-tenant negative test per endpoint (all 404, no leak).
- **Worker vs tenant split in post-repo**: `findPublishDue`/`findCopyGenDue`/`claimForPublish`/`updatePost` stay
  UNSCOPED (cron processes all owners). Tenant routes use scoped `listPosts({ownerId})`/`getPostWithCampaign(id,ownerId)`/
  `approveReview(id,ownerId,…)`. The two classes are commented as such — do not add ownerId to worker queries.
- **404-before-409 ordering** on approve/reject: scoped `getPostForOwner` probe returns 404 for not-found/wrong-tenant
  FIRST, then the atomic status-guarded `updateMany` yields 409 only for genuine wrong-state. Prevents existence leak.
- **`Lead`/`MktRunLog`**: Lead.ownerId NOT NULL + FK (back-filled to system owner); MktRunLog.ownerId nullable, NO FK
  (system/cron rows have no owner; audit must survive user deletion). `logRun(level,step,detail,ownerId?)` now optional-attributes.
- **Route guard swap**: `/posts`+`/campaigns` moved `requireApiKey` → `requireAuth` (server.ts). `requireApiKey` retained
  in `lib/auth.ts` for T6 internal webhook/cron s2s routes (not yet mounted).
- **Removed** unused `getPost(id)` (replaced by scoped `getPostForOwner`/`getPostWithCampaign`); seed.ts + CLIs updated to pass ownerId.

## T3 implementation notes (2026-06-27) — DIVERGED from original plan
- **Language is FREE-FORM, not an enum** (user decision): the `ContentLanguage` enum (`vi|en|both`) was RETIRED.
  Users pick ANY language on the UI (vi/en/fr/de/es/…) and Gemini generates in that language. `User.defaultLanguage`,
  `Campaign.language`, `Post.language` are all `String` (free-form code/label). `both` collapsed to single-language —
  **one language per post** (a bilingual post = two posts). Migration `20260627070000_config_as_data_t3` maps `both`→`vi`.
- **Copy is a JSON bag, not 4 columns** (user decision): `copyVi/copyEn/copyThreads/copyX` columns REPLACED by
  `Post.copy Json = { body, threads, x }` — 3 SEMANTIC variants (not per-platform, not per-language):
  `body` = long (FB/IG/LinkedIn), `threads` ≤480, `x` ≤280. All in the post's resolved language. Scales to any
  language with zero schema change. Adapters select by length budget (was lang-baked fallback chains).
  ⚠ The old "Threads/X always English" rule is GONE — every variant now generates in the chosen language.
- **3-layer resolver** = `src/copygen/resolve-config.ts` (`resolveCopyConfig`): `language = post ?? campaign ?? user`
  (always concrete, user default NOT NULL); `length = post.lengthSpec ?? campaign.defaultLength`; `brandVoice =
  campaign.brandVoice ?? user.brandVoice` (null → personal/persona-free); same for brandContext/brandName.
- **prompt.ts rewritten** persona-optional + language-parameterized. Guardrails PRESERVED (hook ≤50, no HTML, banned
  clichés, ≤480/≤280, lead-form CTA) but translated to English instructions (model still writes in target language).
  Business (brandVoice present) → brand voice + forced #BrandName hashtags; personal (null) → "real person sharing",
  no brand persona, 2-4 natural hashtags. responseSchema `required: [body, threads, x]`.
- **Copy-gen worker query** now includes `campaign.owner` (`PostWithCampaignOwner`) — needed for the user-layer
  fallback. service.ts writes `copy` (cast `as unknown as object` for Prisma JSON input) + resolved `language`.
- **DTO/contract change** (T5 OpenAPI input): postDto `copy: copyBag.nullable()` + `language`; campaignDto gains
  language/defaultLength/platforms/brandVoice/postingWindow/timezone. `copyBag` zod schema added.
- **Campaign cols added now** (user: all-at-once for stable contract): language, default_length, platforms[],
  brand_voice, posting_window, timezone. `platforms`/`postingWindow`/`timezone` NOT consumed until T4/T5 (auto-schedule).
- **`resolve-input.ts`** reads `Post.copy` JSON defensively (`readCopy` narrows partial/null) → PublishInput {body,threads,x}.
- **Known limitation**: campaign reassignment would desync `Post.ownerId` (T2 denorm) — not a v1 feature.

## T4 implementation notes (2026-06-27)
- **Composite PK migration** `20260627080000_per_user_tokens_t4`: add `owner_id` nullable → back-fill 4 live DAIS
  rows onto system owner → drop single-col `_pkey` → NOT NULL → composite PK `(owner_id, platform)` → index + FK
  (ON DELETE CASCADE). One transaction, reversible. **Rows backed up first** → `oauth-token-backup-pre-t4.json`
  (gitignored). Prisma where-key is `ownerId_platform: { ownerId, platform }`.
- **ownerId threading = `PublishInput.ownerId`** (not a new publish param): built from `Post.ownerId` (T2 denorm) in
  `resolve-input.ts`, flows `tick → publishTo → adapter`. All 5 adapters take `getActiveToken(input.ownerId, platform)` +
  `getTokenMeta(input.ownerId, platform)`. Helper fns (pageId/igUserId/userId/ownerUrn) now take `ownerId`. tsc enforces
  completeness (missing arg = compile error) — same explicit-arg rule as T2.
- **token-repo** fully re-keyed: `getToken(ownerId,platform)`, `markTokenStatus(ownerId,platform,status)`,
  `upsertToken({ownerId,…})`, new `listAllTokenKeys()`. `TokenRecord` gains `ownerId`.
- **service**: `getActiveToken/getTokenMeta(ownerId,platform)`; `seedTokensFromEnv(ownerId=SYSTEM_OWNER_ID)` (env tokens
  are DAIS's → default system owner; real users use connect-flow); `runTokenMaintenance()` now walks `listAllTokenKeys()`
  across ALL tenants (was per-platform). CLI `seed [ownerId]`, status shows ownerId.
- **Connect-flow** = `src/social/connect-providers.ts` (registry mirroring tokens/providers.ts) + `src/api/connect-router.ts`.
  `GET /connect/:platform/start` (requireAuth → 302 consent) + `/callback` (public — platform redirect has no auth header).
  **ownerId + PKCE verifier round-trip in a signed 10m state JWT** (HS256, JWT_SECRET) — stateless, survives restart, same
  pattern as auth-router login state. X uses PKCE S256. Meta (FB+IG shared app) does short→long-lived exchange; Threads/
  LinkedIn/X standard code exchange. Token persisted encrypted under `(state.ownerId, platform)`.
- **External-onboarding gate**: each provider `assertConfigured()` fail-fasts (`/start`→500 `connect_not_configured`) until
  its app creds set (META_APP_ID/SECRET, THREADS_APP_ID/SECRET, LINKEDIN_CLIENT_ID/SECRET, X_CLIENT_ID/SECRET, PUBLIC_BASE_URL
  added to env.ts, all default ''). Same bucket as Google login + social app-review — code testable now with own dev app.
- **Verify scripts updated**: `verify-adapters-dryrun.ts` + `test-facebook-publish.ts` pass SYSTEM_OWNER_ID.

## T5 implementation notes (2026-06-27)
- **Event bus** `src/events/bus.ts` = `Map<ownerId, Set<subscriber>>` (NOT EventEmitter — avoids global
  maxListeners(10) ceiling on conn count; per-owner filtering by construction). `subscribe(ownerId,fn)→unsubscribe`,
  `publishPostStatus(ownerId, {postId,status,campaignId?,postUrls?,error?})` never throws (one bad subscriber
  isolated). **Single-process only** — multi-instance deploy needs Redis pub/sub or sticky sessions (documented v1 limit).
- **SSE** `src/api/events-router.ts` `GET /events`: emits `ready` then `post.status` frames; 25s heartbeat (`: ping`)
  beats idle-proxy timeout; `X-Accel-Buffering: no` + `Cache-Control: no-transform` for nginx; unsubscribe on
  `req.close`/`res.error` (leak guard). **Auth = Bearer header OR `?token=` query** (browser EventSource can't set
  headers). ⚠ query-token lands in access logs — acceptable for internal tool; use short-lived stream ticket if it ever
  faces untrusted nets. Mounted WITHOUT requireAuth (that's header-only) — self-authenticates.
- **Emit chokepoints = call sites** (not repo layer — updatePost is unscoped worker fn): scheduler tick (validation-error,
  normal write-back, catch-after-claim), copygen service (review success + bad-brief error), posts-router (approve→ready,
  reject→rework). Each call site already holds post.ownerId + new status.
- **OpenAPI** `src/contract/openapi.ts` via `@asteasolutions/zod-to-openapi@7` (zod-3 compatible; added devDep). Registers
  the EXISTING api/schemas.ts (single source of truth, unchanged) + envelope wrappers `{data,meta?}|{error,details?}` +
  8 path defs (auth/me, posts list/detail/approve/reject, campaigns, connect/start, events). Bearer security scheme.
  `npm run gen:openapi` → `openapi.json` at MKTAgent root (committed — UI runs `openapi-typescript` against it). Verified:
  valid 3.1.0, $refs resolve to registered component schemas, openapi-typescript@7 compiles it cleanly.
- **Known gap**: SSE only emits `post.status` (the review-UI need). Campaign/lead events + a Last-Event-ID replay buffer
  are additive later if the UI needs them. No persistence — a disconnected client misses events in the gap; polling
  `GET /posts?status=` is the reconcile path (plan §5).

## Still open (decide at phase, low-risk)
- T4: connect-flow + Google-login redirect URIs need stable public HTTPS in prod (ties to T7/P8 deploy/domain).
  Dev = localhost callback works now.
- T1: JWT_SECRET rotation strategy — long-lived tokens mean rotation invalidates all sessions; acceptable v1
  (users just re-login via Google, painless). Document, don't over-engineer.
