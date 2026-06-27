-- T3: config-as-data + language-agnostic copy.
--   • Post: replace the 4 language-baked copy columns (copy_vi/en/threads/x) with
--     a single JSON `copy` bag { body, threads, x } + free-form `language`.
--     Existing copy is migrated into the bag (copy_vi → body) before the columns drop.
--   • User.default_language: enum ContentLanguage → free-form TEXT (any language
--     scales without a schema change). The enum type is dropped once unused.
--   • Campaign: add config-as-data defaults (language/default_length/platforms/
--     brand_voice/posting_window/timezone), all nullable → inherit from User.
-- Wrapped in one transaction by Prisma; back-fill runs before the destructive drops.

-- ── Post: copy JSON bag + language ───────────────────────────────────────────
ALTER TABLE "mkt_post" ADD COLUMN "copy" JSONB;
ALTER TABLE "mkt_post" ADD COLUMN "language" TEXT;

-- Migrate existing variants into the bag. copy_vi is the long body (the EN/Threads/X
-- variants were the old single-tenant behaviour); keep threads/x if present.
-- jsonb_strip_nulls drops absent variants so the bag only holds what existed.
UPDATE "mkt_post"
SET "copy" = jsonb_strip_nulls(jsonb_build_object(
      'body',    "copy_vi",
      'threads', "copy_threads",
      'x',       "copy_x"
    )),
    "language" = 'vi'
WHERE "copy_vi" IS NOT NULL
   OR "copy_en" IS NOT NULL
   OR "copy_threads" IS NOT NULL
   OR "copy_x" IS NOT NULL;

ALTER TABLE "mkt_post" DROP COLUMN "copy_vi";
ALTER TABLE "mkt_post" DROP COLUMN "copy_en";
ALTER TABLE "mkt_post" DROP COLUMN "copy_threads";
ALTER TABLE "mkt_post" DROP COLUMN "copy_x";

-- ── User.default_language: enum → text ───────────────────────────────────────
-- Map the retired enum: 'both' collapses to 'vi' (one language per post now).
ALTER TABLE "mkt_user" ALTER COLUMN "default_language" DROP DEFAULT;
ALTER TABLE "mkt_user"
  ALTER COLUMN "default_language" TYPE TEXT
  USING (CASE WHEN "default_language"::text = 'both' THEN 'vi' ELSE "default_language"::text END);
ALTER TABLE "mkt_user" ALTER COLUMN "default_language" SET DEFAULT 'vi';

DROP TYPE "ContentLanguage";

-- ── Campaign: config-as-data columns ─────────────────────────────────────────
ALTER TABLE "mkt_campaign" ADD COLUMN "language" TEXT;
ALTER TABLE "mkt_campaign" ADD COLUMN "default_length" TEXT;
ALTER TABLE "mkt_campaign" ADD COLUMN "platforms" "SocialPlatform"[];
ALTER TABLE "mkt_campaign" ADD COLUMN "brand_voice" TEXT;
ALTER TABLE "mkt_campaign" ADD COLUMN "posting_window" TEXT;
ALTER TABLE "mkt_campaign" ADD COLUMN "timezone" TEXT;
