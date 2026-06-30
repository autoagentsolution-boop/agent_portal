-- Saved Flows: a planned WorkflowRun gets a user-given name before execution.
-- Nullable, no backfill (existing rows stay unnamed transient runs).
ALTER TABLE "wf_run" ADD COLUMN "name" TEXT;
