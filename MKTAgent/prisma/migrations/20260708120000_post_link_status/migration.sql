-- Audit P0-3: persist the last per-platform liveness snapshot so the Leads UI shows
-- the alive/dead markers after a page refresh instead of losing them. LinkStatus[] JSON.
ALTER TABLE "mkt_post" ADD COLUMN "link_status" JSONB;
