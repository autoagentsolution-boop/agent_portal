-- Phase 07 / M3: throttle the proactive liveness sweep. Only re-check a watched post whose
-- last check is older than the throttle window, instead of every 30-min leads tick.
ALTER TABLE "mkt_post" ADD COLUMN "last_liveness_check_at" TIMESTAMPTZ(6);
