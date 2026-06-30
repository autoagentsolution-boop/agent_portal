-- External-action audit log (brief §11.13): one append-only row per outward-writing
-- action the Connector Runtime performs. Nullable owner + no FK so rows survive user
-- deletion (audit must outlive the tenant). Request/response detail is REDACTED by the
-- writer — no token/secret is ever stored here.
CREATE TABLE "external_action_audit_log" (
  "id"          BIGSERIAL NOT NULL,
  "owner_id"    UUID,
  "run_id"      UUID,
  "node_id"     TEXT,
  "platform"    TEXT NOT NULL,
  "action_key"  TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "external_id" TEXT,
  "error"       TEXT,
  "detail"      JSONB,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_action_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_ext_audit_created" ON "external_action_audit_log" ("created_at" DESC);
CREATE INDEX "ix_ext_audit_owner" ON "external_action_audit_log" ("owner_id");
CREATE INDEX "ix_ext_audit_run" ON "external_action_audit_log" ("run_id");
