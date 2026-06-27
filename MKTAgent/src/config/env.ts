// Centralized, zod-validated environment config. Fail-fast at boot: a missing
// critical var throws here instead of surfacing as a confusing runtime error
// deep inside an adapter.
//
// Tiering: `required` blocks boot; per-platform/per-feature vars are optional
// and validated lazily by the module that needs them (a deploy may run only
// the scheduler, or only lead capture).
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(7100),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Internal API auth (REST + webhooks). Comma-separated keys allowed.
  MKT_API_KEYS: z.string().default(''),
  // Background workers (off by default so dev/CLI runs don't auto-post).
  ENABLE_SCHEDULER_CRON: z.coerce.boolean().default(false),
  ENABLE_TOKEN_CRON: z.coerce.boolean().default(false),
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

  // Gemini (copy-gen)
  GEMINI_API_KEY: z.string().default(''),

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
