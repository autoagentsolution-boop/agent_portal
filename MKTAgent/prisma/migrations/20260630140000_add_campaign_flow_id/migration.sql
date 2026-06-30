-- Link a Campaign to the Flow (orchestration run) that spawned it, for the merged
-- Flow → Campaign → Post sidebar tree. Nullable: direct-created campaigns have none.
-- ON DELETE SET NULL: deleting a flow must NOT delete its campaigns/posts (generated
-- content, incl. paid images, outlives the flow) — the campaign just becomes orphaned
-- (shown under "Ungrouped" in the UI).
ALTER TABLE "mkt_campaign" ADD COLUMN "flow_id" UUID;

ALTER TABLE "mkt_campaign"
  ADD CONSTRAINT "mkt_campaign_flow_id_fkey"
  FOREIGN KEY ("flow_id") REFERENCES "wf_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ix_campaign_flow" ON "mkt_campaign" ("flow_id");
