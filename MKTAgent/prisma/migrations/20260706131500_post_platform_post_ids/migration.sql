-- Canonical resolvable platform object ids captured at publish (numeric media id / {page}_{post} /
-- tweet id / share urn). Lets the lead collector + liveness check avoid the unresolvable permalink
-- shortcode. Additive + nullable; existing rows stay null (no backfill possible for old posts).
ALTER TABLE "mkt_post" ADD COLUMN "platform_post_ids" JSONB;
