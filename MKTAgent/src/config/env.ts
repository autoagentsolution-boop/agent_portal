// Centralized, zod-validated environment config. Fail-fast at boot: a missing
// critical var throws here instead of surfacing as a confusing runtime error
// deep inside an adapter.
//
// Tiering: `required` blocks boot; per-platform/per-feature vars are optional
// and validated lazily by the module that needs them (a deploy may run only
// the scheduler, or only lead capture).
import 'dotenv/config';
import { z } from 'zod';

// Strict boolean env parse. `z.coerce.boolean()` is truthy for ANY non-empty string, so
// `ENABLE_X=false` / `"0"` coerced to `true` — a flag you literally cannot turn off. Map the
// conventional string forms explicitly; unrecognized/blank falls back to the declared default.
const boolEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return def;
      const s = v.trim().toLowerCase();
      if (s === '') return def;
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off'].includes(s)) return false;
      return def;
    });

const schema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(7100),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Internal API auth (REST + webhooks). Comma-separated keys allowed.
  MKT_API_KEYS: z.string().default(''),
  // Background workers (off by default so dev/CLI runs don't auto-post).
  ENABLE_SCHEDULER_CRON: boolEnv(false),
  // Generic resume-due-runs cron (generic-scheduler node): re-enters parked (status='scheduled') runs at
  // their confirmed time. OFF by default like the other workers; enable alongside ENABLE_SCHEDULER_CRON.
  ENABLE_SCHEDULER_RESUME: boolEnv(false),
  ENABLE_TOKEN_CRON: boolEnv(false),
  // Token encryption (32 bytes hex). Required once tokens module is used; we
  // validate format here but allow empty in dev so scaffold boots.
  TOKEN_ENC_KEY: z
    .string()
    .regex(/^([0-9a-fA-F]{64})?$/, 'TOKEN_ENC_KEY must be 64 hex chars or empty')
    .default(''),

  // Google (Drive asset store + Sheets import + Gmail notify). OAuth client.
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REFRESH_TOKEN: z.string().default(''),
  // App-login OAuth redirect (distinct from Drive scope — identity only). Dev =
  // localhost callback; prod needs HTTPS (ties to T7/P8 deploy).
  GOOGLE_OAUTH_REDIRECT_URI: z
    .string()
    .default('http://localhost:7100/auth/google/callback'),

  // App auth: long-lived JWT (HS256). No refresh token — user wants zero re-auth
  // friction; rotating JWT_SECRET invalidates all sessions (re-login via Google).
  JWT_SECRET: z.string().default(''),
  JWT_TTL: z.string().default('60d'), // jsonwebtoken expiresIn syntax

  // Browser BFF (T8). UI_BASE_URL set → OAuth callback issues an HttpOnly session
  // cookie + redirects here (no token in the URL); also the sole allowed CORS
  // origin for credentialed XHR. Empty → CLI/JSON-token fallback, CORS off.
  UI_BASE_URL: z.string().default(''),
  SESSION_TTL: z.string().default('30d'), // opaque-session lifetime: <n>[smhd]

  // Gemini (copy-gen)
  GEMINI_API_KEY: z.string().default(''),
  // Veo image-to-video model (video agent). Empty → veo-3.1-lite (cheapest i2v tier).
  VEO_MODEL: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ENABLE_COPYGEN_CRON: boolEnv(false),
  // Auto-run the lead collector (comment-keyword poll) every 30 min across all tenants.
  ENABLE_LEADS_CRON: boolEnv(false),
  // Throttle for the proactive liveness sweep (Phase 07 / M3): a watched post is re-checked only
  // when its last sweep is older than this many hours (default 6), instead of every 30-min tick.
  LEADS_LIVENESS_THROTTLE_HOURS: z.coerce.number().positive().default(6),
  // Atria autonomy (Phase 01): per-gate spend ceiling a GRANTED run may auto-waive at a cost
  // gate (e.g. the Veo video step, ≈$0.40/8s). Above this, the run parks + notifies for a human
  // OK. 0 → never auto-waive any cost gate (fail-closed). Default $2 allows one video autonomously.
  ATRIA_AUTONOMY_COST_CEILING_USD: z.coerce.number().nonnegative().default(2),
  // Self-healing reaper (Phase 04): a cron that rescues rows stuck in a transient state after a
  // crash/redeploy — no row may sit `posting`/`running` forever. OFF by default (like the other
  // workers). Timeouts are minutes and set GENEROUSLY above real max durations to avoid false
  // reaping; the video node gets a bigger budget (Veo render is minutes × N clips).
  ENABLE_REAPER_CRON: boolEnv(false),
  REAPER_POSTING_TIMEOUT_MIN: z.coerce.number().positive().default(10), // post stuck `posting`
  REAPER_RUN_TIMEOUT_MIN: z.coerce.number().positive().default(20),     // run stuck `running`
  REAPER_NODE_TIMEOUT_MIN: z.coerce.number().positive().default(10),    // non-video node `running`
  REAPER_VIDEO_NODE_TIMEOUT_MIN: z.coerce.number().positive().default(30), // video node `running`
  REAPER_ORPHAN_TTL_DAYS: z.coerce.number().positive().default(7),      // needs_approval/planned surfacing

  // Autonomy kickoff (Phase 04): a cron that actually STARTS granted-but-unstarted runs
  // (approvalMode='atria' left at 'planned'). Without it, granting autonomy only removes the human
  // gate — nothing runs the DAG. OFF by default (like the other workers). Publishing on this path is
  // forced DRY-RUN in the runner (demo decision "tự chạy nhưng DRY") — the loop completes end-to-end
  // without a real external post. MAX_PER_TICK bounds fan-out so one tick can't stampede the executor.
  ENABLE_AUTONOMY_CRON: boolEnv(false),
  AUTONOMY_MAX_PER_TICK: z.coerce.number().int().positive().default(3),

  // Lead Nurture Agent (Phase 01): the driver cron that enrolls eligible leads, plans due touches,
  // and kicks off their (approval-gated) send runs. OFF by default like the other workers — with it
  // off, nothing is enrolled/planned even if a per-owner nurtureEnabled toggle is later flipped on.
  // Every touch still halts at its email_agent/scheduler approval gate regardless of this flag.
  ENABLE_NURTURE_CRON: boolEnv(false),
  NURTURE_MAX_PER_TICK: z.coerce.number().int().positive().default(5),

  // Lead Nurture Agent Phase 02: the reply-ingestion cron (reads lead replies via gmail.readonly).
  // OFF by default like every other worker. An owner who hasn't re-consented to the read scope yet
  // (or has it off) degrades to Phase 01's one-way drip for that tick — this flag never crashes on a
  // missing scope, it just gates whether the sweep runs at all.
  ENABLE_NURTURE_REPLY_CRON: boolEnv(false),

  // Impact / value report (Atria Phase 07). The CONFIGURABLE market baseline the Impact report
  // compares Atria's real spend against — a workspace tunes these to its own market. Cost SAVED and
  // reach are ESTIMATES derived from them (clearly labeled in the report); real spend/output/leads
  // are measured. Defaults are conservative mid-market figures.
  IMPACT_AGENCY_DAY_RATE_USD: z.coerce.number().nonnegative().default(500),   // agency day rate
  IMPACT_HOURS_PER_POST: z.coerce.number().nonnegative().default(2),          // human hours to make one post
  IMPACT_WORK_HOURS_PER_DAY: z.coerce.number().positive().default(8),         // hours in a work day
  IMPACT_FREELANCER_PER_POST_USD: z.coerce.number().nonnegative().default(50),// freelancer per-post rate
  IMPACT_REACH_PER_POST: z.coerce.number().nonnegative().default(300),        // est. reach per published post (LABELED estimate)

  // Lead capture
  MKT_LEAD_WEBHOOK_SECRET: z.string().default(''),
  MKT_CALCOM_WEBHOOK_SECRET: z.string().default(''),
  MKT_SALES_EMAIL: z.string().default(''),

  // Facebook / Instagram / Threads (Meta)
  MKT_FB_PAGE_ID: z.string().default(''),
  MKT_FB_PAGE_ACCESS_TOKEN: z.string().default(''),
  MKT_IG_USER_ID: z.string().default(''),
  MKT_IG_ACCESS_TOKEN: z.string().default(''),
  MKT_THREADS_USER_ID: z.string().default(''),
  MKT_THREADS_ACCESS_TOKEN: z.string().default(''),

  // LinkedIn
  MKT_LINKEDIN_PERSON_ID: z.string().default(''),
  MKT_LINKEDIN_ACCESS_TOKEN: z.string().default(''),

  // X / Twitter
  MKT_X_ACCESS_TOKEN: z.string().default(''),

  // Graph API versions (pinned; overridable)
  GRAPH_VERSION: z.string().default('v25.0'),
  THREADS_VERSION: z.string().default('v1.0'),

  // Per-user social connect-flow OAuth clients (T4). Distinct from the DAIS
  // env-seeded long-lived tokens — these onboard REAL users via consent. Each is
  // optional; the connect endpoint for a platform fail-fasts (500) until its app
  // creds are set, gated the same way as Google login (external app-review bucket).
  // Public base for building absolute connect callback URIs (dev = localhost). Empty
  // string in .env would otherwise override the default and yield a RELATIVE redirect_uri
  // that Google/Meta reject → coalesce blank back to the dev default.
  PUBLIC_BASE_URL: z
    .string()
    .default('http://localhost:7100')
    .transform((v) => v.trim() || 'http://localhost:7100'),
  // Meta (FB Pages + IG + Threads share one Meta app; Threads may use its own).
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  THREADS_APP_ID: z.string().default(''),
  THREADS_APP_SECRET: z.string().default(''),
  // Meta comment-capture webhook (Multichannel Nurture Phase 03). The shared secret Meta's App
  // Dashboard presents back as `hub.verify_token` during the one-time subscribe handshake (GET
  // /webhooks/meta). Every SUBSEQUENT delivery (POST) is verified by HMAC-SHA256 over the raw body
  // keyed with META_APP_SECRET (above), NOT this token — see src/leads/sources/meta-webhook.ts.
  META_WEBHOOK_VERIFY_TOKEN: z.string().default(''),
  // LinkedIn OAuth 2.0 (Sign In with LinkedIn + w_member_social).
  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  // X / Twitter OAuth2 user-context (PKCE). Reuses X_CLIENT_ID/SECRET that the
  // token refresh provider already reads from process.env.
  X_CLIENT_ID: z.string().default(''),
  X_CLIENT_SECRET: z.string().default(''),

  // Messaging / DM nurture (Multi-channel Nurture Nodes Phase 01). Every channel adapter defaults to
  // DRY-RUN (feedback_no_burst_social_posts): a real send requires BOTH the channel's token AND this
  // master flag explicitly on. OFF by default — no live credentials exist yet (2026-07), so every
  // deployment stays DRY-RUN until deliberately flipped (see src/messaging/types.ts isLiveDmSend).
  ENABLE_LIVE_DM_SEND: boolEnv(false),
  // WhatsApp Cloud API (Meta Graph — reuses GRAPH_VERSION above).
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  // Telegram Bot API.
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  // Optional shared secret Telegram echoes back as `X-Telegram-Bot-Api-Secret-Token` (set via the
  // Bot API's setWebhook `secret_token`) — verifies an inbound /webhook/telegram call really came
  // from Telegram. Empty → the check is skipped (dev / not-yet-registered webhook).
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  // Zalo ZNS — VN-only, needs ZNS template approval (deferred, plan phase-01 verdict 🟡). ENABLE_ZALO
  // gates it OFF the live-send path even when a token is present (see isLiveDmSend); the adapter code
  // exists so flipping this + ENABLE_LIVE_DM_SEND is the only change needed once ZNS is approved.
  ZALO_OA_ACCESS_TOKEN: z.string().default(''),
  ZALO_TEMPLATE_ID: z.string().default(''),
  ENABLE_ZALO: boolEnv(false),

  // Wall-greeting mention/reply (Multi-channel Nurture Nodes Phase 02). Brand-new, never
  // live-tested social-write actions — even a tenant with an already-connected PUBLISH token must
  // not silently start posting greetings the moment this ships. OFF by default everywhere; see
  // src/social/greeting.ts's isLiveGreetingSend (mirrors ENABLE_LIVE_DM_SEND's fail-closed gate).
  ENABLE_LIVE_GREETING_SEND: boolEnv(false),

  // Live social PUBLISH kill-switch. Unlike the DM/greeting gates above this defaults ON — a
  // marketing publish is the product's primary path and every deployment depends on it, so a
  // fail-closed default would be a silent breaking change. Set it false to drive a flow end to end
  // (planning → assets → cost gate → publisher node) with the platform network call SIMULATED, so an
  // observed live test exercises the real publisher without posting to a connected page
  // (feedback_no_burst_social_posts). See src/social/index.ts's isLiveSocialPublish.
  ENABLE_LIVE_SOCIAL_PUBLISH: boolEnv(true),

  // X/Twitter comment-read (Multichannel Nurture Phase 03 hardening) needs a PAID API tier
  // (recent-search is gated above free). OFF by default so a tenant on the free tier never burns a
  // 401/403 call every 30-min poll cycle — comment-fetchers/x.ts short-circuits to a clean [] no-op
  // until this is explicitly flipped on (confirm the connected token's tier first).
  ENABLE_X_LEAD_CAPTURE: boolEnv(false),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`env validation failed: ${issues}`);
}

export const env = parsed.data;

export const apiKeys = new Set(
  env.MKT_API_KEYS.split(',')
    .map((k) => k.trim())
    .filter(Boolean),
);
