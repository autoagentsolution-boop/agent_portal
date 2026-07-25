# Raw agent report — API + Data + Auth layer (Agent 2)

> Raw output from the read-only explore agent. Feeds ARCHITECTURE_MAP.md §2 (Modules), §3 (Data Flow), §4 (Deps), §5 (Risk), §6 (Hidden Logic).
> Scope: `src/api/` (36 files), `src/db/` (18), `prisma/schema.prisma`, `src/config/env.ts`, `src/server.ts`, `src/contract/`, `src/system/`, `src/events/`, `src/i18n/`, `src/lib/`.

**PM orientation:** MKTAgent = multi-tenant marketing automation backend. Google login → AI Master Agent (Atria) plans+runs multi-step "flows" (research→copy→image/video→publish). Every tenant walled by owner id. Money = "credits" wallet; real Google-AI spend tracked separately. Leads flow in from webhooks/forms/comments, nurtured by email. Super-admin console grants credits + sees capability requests.

## 1. Request lifecycle (server.ts, Express 5)
helmet (`:55`, crossOriginResourcePolicy relaxed for SPA `/media/*`) → cors (only if UI_BASE_URL, `:61-63`) → cookieParser (`:64`) → body parsers in DELIBERATE ORDER (large-body BEFORE global 1MB cap): `/product-knowledge`+`/posts` 20MB (`:69,:73`), `/webhooks/meta` raw-body for HMAC (`:79`), global json 1mb (`:81`) → requireAuth → router → parseOr422 Zod → repo (ownerId-scoped) → Postgres/Prisma → uniform envelope `{data,meta}`/`{error,details,params}` → global error handler (`:175-192`: malformed JSON→400, 4xx passthrough, else 500). Crons start at boot only if env flag on (`:198-206`).

## 2. Auth — FIVE distinct mechanisms (the key cross-cutting concept)
- **2a Session cookie (browser BFF)** `lib/session.ts`: opaque 256-bit handle in HttpOnly cookie `mkt_session` (`:12,:35`); only SHA-256 of handle stored (`:38`); server-revocable; constant-time compare (`:56-58`); TTL from SESSION_TTL (30d); cookie `httpOnly`+`sameSite:lax`+`secure` in prod (`auth-router.ts:30-36`).
- **2b Bearer JWT HS256** `lib/auth-jwt.ts`: long-lived (JWT_TTL 60d), NO refresh by design; sub=userId+email; for CLI/tests/s2s + fallback when UI_BASE_URL unset.
- **2c requireAuth resolution order** `middleware-auth.ts:31`: Bearer JWT first (`:33-39`) → session cookie (`:40-41`); absence→401 (reason never leaked `:47-48`).
- **2d Super-admin gate** `middleware-superadmin.ts`: after requireAuth, checks `User.isSuperAdmin`; non-admin → **404 not 403** (`:11-14`) so admin surface invisible. `/superadminatria101` URL = defense-in-depth; flag is real boundary.
- **2e API key** `lib/auth.ts requireApiKey`: `x-api-key` constant-time vs MKT_API_KEYS. **NOT mounted anywhere** — reserved for later phases (`server.ts:111`). Currently DEAD in HTTP path.
- **2f Secret/HMAC-gated public routes**: lead intake (per-owner token OR legacy global secret→SYSTEM_OWNER, `leads-router.ts:46-58`); Meta webhook HMAC-SHA256 raw body; unsubscribe HMAC link (`:126`); OAuth callbacks (public, ownerId+PKCE in signed 10-min state JWT); autonomy grant (stateless HMAC double-confirm); SSE `/events` self-auths Bearer/cookie/`?token=` (`events-router.ts:20-30`, NOT behind header-only requireAuth).

**Frontend↔backend flow:** Google login → `/auth/google/callback` exchange → upsertGoogleUser → ensureTrialGrant → if UI_BASE_URL: createSession + cookie + 302 (no token readable); else CLI returns `{token}`. Browser calls send HttpOnly cookie; requireAuth → ownerId.

## 3. Env config tiers (config/env.ts, Zod fail-fast `:228-232`)
Custom `boolEnv` (`:14-25`) fixes `z.coerce.boolean('false')===true` trap.
- **REQUIRED (blocks boot):** `DATABASE_URL` (only hard-required, `:31`).
- **Core w/ defaults:** NODE_ENV, PORT (7100), JWT_SECRET (''), TOKEN_ENC_KEY (64hex or empty; empty boots but throws when crypto used, `:42-45`).
- **Feature-lazy tiers:** Auth (GOOGLE_*, JWT_TTL 60d, UI_BASE_URL, SESSION_TTL 30d, PUBLIC_BASE_URL). AI (GEMINI_API_KEY, GEMINI_MODEL gemini-2.5-flash, VEO_MODEL).
- **Cron toggles (all OFF except publish):** ENABLE_SCHEDULER_CRON, _RESUME, _TOKEN, _COPYGEN, _LEADS, _REAPER, _AUTONOMY, _NURTURE, _NURTURE_REPLY.
- **Live-action kill switches:** ENABLE_LIVE_DM_SEND (OFF), _GREETING_SEND (OFF), _ZALO (OFF), _X_LEAD_CAPTURE (OFF), **ENABLE_LIVE_SOCIAL_PUBLISH defaults ON** (`:211`).
- **Magic-number config:** ATRIA_AUTONOMY_COST_CEILING_USD (2), LEADS_LIVENESS_THROTTLE_HOURS (6), reaper timeouts (POSTING 10, RUN 20, NODE 10, VIDEO_NODE 30, ORPHAN_TTL_DAYS 7), AUTONOMY_MAX_PER_TICK (3), NURTURE_MAX_PER_TICK (5), impact baselines (AGENCY_DAY_RATE 500, HOURS_PER_POST 2, FREELANCER_PER_POST 50, REACH_PER_POST 300).
- Per-platform social creds (all ''); lead secrets; messaging tokens; MKT_API_KEYS; FFMPEG_PATH (ffmpeg).

## 4. Data model (prisma/schema.prisma) — every table
| Model (table) | Purpose | FKs | Notes |
|---|---|---|---|
| User (mkt_user) | tenant/customer, identity=Google email, owns all | — root | isSuperAdmin, defaultLanguage(content) vs uiLanguage(interface) |
| CreditLedger (mkt_credit_ledger) | append-only wallet, balance=SUM(delta) | ownerId Cascade | runId/grantedBy no FK; multiple debits/run allowed |
| UserMemory (mkt_memory) | durable facts Atria recalls | ownerId Cascade | @@unique(ownerId,kind,key) |
| RoadmapDemand (mkt_roadmap_demand) | AI pitches + capability requests | ownerId Cascade | spec Json |
| Instruction (mkt_instruction) | layered custom instructions | ownerId Cascade | scopeRefId no FK (polymorphic) |
| LeadIntakeToken (mkt_lead_intake_token) | per-owner intake secret | ownerId Cascade | SHA-256 hash only |
| Session (mkt_session) | opaque browser BFF | ownerId Cascade | tokenHash unique |
| Campaign (mkt_campaign) | campaign root, spawns posts | ownerId Cascade, flowId→WorkflowRun SetNull, productKnowledgeId SetNull | config-as-data |
| Post (mkt_post) | one publication + state machine | campaignId Cascade, ownerId Cascade (denorm), runId SetNull, productKnowledgeId SetNull | PostStatus enum, rich Json |
| ProductKnowledge (mkt_product_knowledge) | reusable product facts | ownerId Cascade | |
| Lead (mkt_lead) | inbound lead, PII encrypted | ownerId Cascade; 1:1 LeadNurtureThread | AES-256-GCM PII; emailBidx blind index; email nullable |
| LeadNurtureThread (mkt_nurture_thread) | 1 drip thread/lead | ownerId Cascade, leadId Cascade **@unique** | nextPlanAt = atomic claim flag |
| NurtureTouch (mkt_nurture_touch) | 1 touch in sequence | threadId Cascade | runId no FK |
| InboundReply (mkt_inbound_reply) | 1 Gmail reply | threadId Cascade | gmailMessageId unique idempotent; bodyEnc |
| NurtureSuppression (mkt_nurture_suppression) | global opt-out by email | ownerId Cascade | @@unique(ownerId,emailLower) |
| DmContact (mkt_dm_contact) | 1 DM recipient/channel | ownerId Cascade | externalId enc, externalIdBidx; @@unique(ownerId,channel,externalIdBidx) |
| DmMessage (mkt_dm_message) | per-send DM log | ownerId Cascade, contactId Cascade | runId **@unique** (≤1/run); bodyEnc |
| **OAuthToken (mkt_oauth_token)** | per-tenant social tokens | ownerId Cascade | **@@id([ownerId,platform]) — ONE account/platform/tenant** ⚠ flagged |
| AgentChatSession (agent_chat_session) | MA chat history | ownerId Cascade | |
| AgentChatMessage (agent_chat_message) | 1 message | sessionId Cascade | |
| AgentCredential (agent_credential) | non-OAuth provider keys | ownerId Cascade | @@unique(ownerId,agentId,key); paste-token path |
| WorkflowRun (wf_run) | orchestration record, template/instance | ownerId Cascade, self templateId SetNull | free-form status; approvalMode human/atria |
| WorkflowNodeRun (wf_node_run) | 1 node exec + cost | runId Cascade | |
| Artifact (wf_artifact) | typed agent output | runId Cascade | validated at executor, not DB |
| SystemFlag (mkt_system_flag) | runtime flags (kill switch) | — no FK | PK = string key |

**Composite/special:** OAuthToken `@@id([ownerId,platform])` (`:759`) — one-account-per-platform; re-connect upserts same row (`token-repo.ts:35`). CreditLedger has NO unique-run constraint (deliberately removed).
**No-FK "best-effort ledger":** MktRunLog (mkt_run_log, `:930-943`), LlmUsage (mkt_llm_usage, `:953-976`, explicit "no FK" comment `:968`), ExternalActionAuditLog (external_action_audit_log, `:995-1012`) — nullable owner, no FK, survive user deletion, never block. BigInt PKs.
**Enums:** PostStatus (brief→review→rework→ready→posting→posted/partial/error), AssetType (image/carousel/video/text), SocialPlatform (fb/ig/threads/linkedin/x), LeadSource, MessagingChannel, DmOptInState, TokenStatus, AccountType, UserRole, InstructionScope, InstructionSource, NurtureStatus, NurtureMode.

## 5. Repos (db/repos/, 16) — shared tenancy rule: tenant-facing REQUIRES ownerId (missing=compile error), wrong tenant→null/false→404. Worker/cron reads unscoped, write scoped by id. Guarded transitions = updateMany+count===1.
- **client.ts** — singleton Prisma (PG adapter) + logRun. Risk HIGH (touch=whole app).
- **system-owner.ts** — SYSTEM_OWNER_ID `00000000-…-0001` single-tenant fallback. Risk LOW.
- **user-repo** — upsertGoogleUser (keys on googleSub not email), getUserById, setUiLanguage, setNurtureSettings. Risk MED.
- **campaign-repo** — CRUD via updateMany/deleteMany guards. Risk LOW.
- **post-repo** — the state machine, MOST COMPLEX. Worker (unscoped): findCopyGenDue, findPublishDueBatch, claimForPublish, reapPostingToError; tenant: getPostWithCampaign, listPosts (keyset limit+1), approveReview, createPostForOwner, editPostCopy, attachPostMedia, sweepUnpublishedCampaignPosts (txn), findPostByCommentSource (webhook unscoped, `:365-380`). Magic: claim ready→posting guarded (`:59-77`); EDITABLE=brief/review/rework/error (`:185`); SCHEDULABLE +ready (`:245`); SWEEPABLE excludes live (`:336`). **Risk HIGH** (double-publish/lost-edits).
- **lead-repo** — createLead, decryptLead, dedupe (emailBidx/platform/booking), searchLeadsByName. Magic: AES-256-GCM; **30-day dedupe window app-level not DB** (`:109`); handle-only email='' (`:64`); name search 500 rows in-memory AND (`:172-192`); legacy plaintext tolerated (`:57`). **Risk HIGH** (PII+dedupe).
- **token-repo** — upsertToken/getToken/markTokenStatus/listAllTokenKeys/listTokenStatusForOwner. Composite PK = 1 account/platform. Risk MED.
- **credit-repo** — getBalance, addLedgerEntry, grantCredits, ensureTrialGrant (idempotent), reconcileRunDebit. **TRIAL_CREDITS=2000** (`:10`); ensureTrialGrant uses **pg_advisory_xact_lock(hashtext(ownerId))** for double-first-login TOCTOU (`:57-58`); reconcileRunDebit charges only positive delta above already-debited, advisory lock on runId (`:128-142`); old one-debit-per-run unique index removed. **Risk HIGH** (money).
- **workflow-run-repo** (~790 lines, largest) — createRun/Nodes, cloneTemplateRun (re-validates agents), runCredits (billing SoT), getFlowCostRollup, grantAutonomy, reaper queries, scheduler claims, transitions. **billing double-count fix 2026-07-18** — bills from costUsd alone (`:294-330`); **"re-runs on us"** resetNodes no accumulation (`:736-766`); getLatestRunWithNodesForChat filters templateId:null NOT kind (`:459-464`). **Risk HIGH** (engine persistence).
- agent-credential-repo (read side, savePublisherCredential, getPublisherPlatformToken) Risk MED; instruction-repo (memory=instructions source='memory') LOW; lead-intake-token-repo (createIntakeToken atk_ prefix, resolveOwnerByToken IS auth) MED; product-knowledge-repo (resolveLinkedKnowledge post>campaign precedence) LOW; provider-spend-repo (getProviderSpend 24h/7d/30d/lifetime, **no API exposes prepaid balance** `:5-9`) LOW; roadmap-demand-repo LOW; user-memory-repo LOW.

## 6. Routers (all tenant routers behind requireAuth)
- **auth-router** (/auth, authLimiter) — Google login→cookie/JWT, /me, PATCH ui-lang. Callback CSRF via 10-min HMAC state JWT (`:46-60`); **shared with Drive connect** — drive-scoped state bounces to completeDriveConnect before login (`:77-89`); trial grant failure swallowed. **Risk HIGH**.
- **connect-router** + **drive-connect-router** — per-user social + Drive OAuth. /start requireAuth, /callback public + PKCE in signed state; state binds to one platform (mismatch→400 `:107`); drive router mounted BEFORE /connect (`server.ts:106`). **Risk HIGH**.
- **leads-router** (mixed auth) — public secret-gated (/webhook,/form,/calcom,/unsubscribe) + JWT (/intake-tokens,/poll-comments,/:id/rescore,/). safeEqual const-time. **Risk HIGH** (public attack surface + PII).
- **posts-router** — review gate + CRUD + generate/refine/publish-now/collector/grant-autonomy. **COLLECTOR_TTL_DAYS=30** (`:23`); 404-before-409; approve idempotent for auto-approved (`:421-425`); copy edits mirror onto concept else revert. **Risk HIGH**.
- post-media-router (20MB, ref-image upload) MED; campaigns-router (materialize, grant 2-step HMAC, platform inherit "collapsed to FB" bug `:64-76`, totalCeiling×posts `:186`) **HIGH**; workspaces-router (read-only reframe) LOW.
- **orchestration-router** (~950 lines, /orchestration, llmLimiter) — the engine API. POST /runs (brain), summarize-file, clarify/save/execute/test-run, approve-node, rerun-node, materialize-calendar, killswitch, usage, agents. **Credit gate blocks flow at ≤0 BEFORE connection gate** (`:169-173`); detached launchWorkflow + markRunCrashed backstop (`:477-498`); rerun-node atomic claim + already-posted guard. **Risk HIGH**.
- orchestration-chat.ts (helper, hardcoded VN/EN confirm strings `:118-158`) MED.
- instructions-router LOW; memory-router (Memory Agent, /facts/:id before /:id `:60`) LOW; email-router (recipient from LEAD not body `:49`, global opt-out before send `:64`) MED; product-knowledge-router (20MB, MAX_B64_LEN 8MB ≤6 files `:38-44`) MED.
- **nurture-router** — Nurture Inbox approve/reject/pause/convert/opt-out. **ONLY caller that waives a nurture approval gate** — runWorkflow direct w/ approveNodeId (`:8-13,:102`); recipient never editable (`:80-90`); preSendCheck every gate; opt-out→global suppression; settings maxTouches 1-12, gapDays 1-30. **Risk HIGH**.
- atria-router (suggestions/pitches, pitch logged once) LOW; impact-router LOW; voice-router (TTS, MAX_TEXT 4000, TTS_COST 0.02, MIN_INTERVAL 1500ms in-process throttle `:15-22`) MED; **agent-router** (typed intake + chats + credential save; **credential allowlist** per agentId `:30-60`; save platform token → liveness verify syncs OAuthToken `:169-174`) **HIGH**; admin-router (super-admin, grant P2003→404 `:36-38`, max 1M) MED; **events-router** (SSE, self-auth Bearer/cookie/?token; HEARTBEAT_MS 25000; unsubscribe on close or Set leaks) MED.

## 7. Support modules
- **http.ts** — ok/fail envelope, parseOr422, asyncHandler; fail carries CODES+i18n params. All routers depend. Risk HIGH.
- **rate-limits.ts** — authLimiter (10/min IP), llmLimiter (20/min TENANT, **GETs exempt** `:44-52` — limiting reads 429'd status-pollers). MED.
- **schemas.ts** — single source of REST contract (Zod→runtime+TS+OpenAPI). Risk HIGH.
- connection-state.ts (connected/needs_attention derivation); concept-mirror.ts (copy edits→concept artifact + re-derive keyMessage else revert); mappers (row→DTO, dates→ISO); autonomy-grant-token.ts (stateless HMAC double-confirm run+campaign scoped, JWT_SECRET dev fallback).
- **crypto.ts** — AES-256-GCM (`v1.<iv>.<tag>.<ct>`), blindIndex (keyed HMAC PII equality), safeEqual. Key from TOKEN_ENC_KEY. **Risk HIGH** (security core).
- google-oauth.ts (login-only, access_type:online no refresh); logger.ts; retry.ts + quota-error.ts (429 per-min transient vs per-day/billing terminal, terminal NOT retried `:120`); user-message.ts.
- **events/bus.ts** — in-process per-tenant Map<ownerId,Set>. **Single-process only — multi-instance needs Redis** (`:3`). Never throws.
- **system/kill-switch.ts** — global pause via SystemFlag, 3s cache. **Fails CLOSED on DB read fault** (2026-07-18, `:26-47`).
- i18n/ui-languages.ts (30-code interface allow-list); contract/openapi.ts (OpenAPI 3.1 from Zod; documents SUBSET; /auth/me schema slightly stale — omits credits/isSuperAdmin/uiLanguage).

## 8. UNCLEAR / flagged
- `verify-credit-gating-and-admin-http.ts`, `verify-post-from-agent.ts`, `verify-post-platform-inherit.ts`, `db/repos/verify-credit-wallet.ts`, `verify-provider-spend.ts` — test scripts, not runtime.
- `lib/auth.ts (requireApiKey)` — defined but NOT mounted (`server.ts:111`). Dead in HTTP path.
- `contract/openapi.ts` — documents only subset of ~30 routers. OpenAPI NOT a complete contract.

## 9. Cross-cutting invariants (PM)
1. Tenant isolation enforced in REPO layer, not just middleware (wrong tenant→404, no existence leak).
2. Secrets never leave DB layer cleartext (tokens+PII AES-256-GCM; API returns metadata only).
3. Two money ledgers — tenant credits (CreditLedger) vs provider spend (LlmUsage); conflating warned against.
4. External writes gated — human approval default, backend double-confirm for autonomy, kill switch fails closed.
5. SSE bus + some throttles in-process only — v1 single-instance constraint, breaks on horizontal scaling.
