-- AlterTable
ALTER TABLE "wf_run" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'instance',
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "template_id" UUID;

-- CreateIndex
CREATE INDEX "ix_wf_run_owner_kind" ON "wf_run"("owner_id", "kind");

-- CreateIndex
CREATE INDEX "ix_wf_run_template" ON "wf_run"("template_id");

-- AddForeignKey
ALTER TABLE "wf_run" ADD CONSTRAINT "wf_run_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "wf_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
