-- AlterTable
ALTER TABLE "wf_run" ADD COLUMN     "scheduled_resume_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ix_wf_run_status_resume" ON "wf_run"("status", "scheduled_resume_at");
