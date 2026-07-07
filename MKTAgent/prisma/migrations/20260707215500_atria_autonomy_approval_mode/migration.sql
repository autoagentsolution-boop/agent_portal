-- Atria autonomy hardening Phase 01 — machine-approval seam.
-- approval_mode: 'human' (default; unchanged UI-gated behavior) | 'atria' (pre-authorized
-- grant lets the run clear its own action gates when guardrails pass). Set only by the
-- grant endpoint. schedule_confirmed: a scheduled autonomous run must be re-confirmed after
-- its schedule is set before the scheduler may fire it (Phase 03 consumes it).
ALTER TABLE "wf_run" ADD COLUMN "approval_mode" TEXT NOT NULL DEFAULT 'human';
ALTER TABLE "wf_run" ADD COLUMN "schedule_confirmed" BOOLEAN NOT NULL DEFAULT false;
