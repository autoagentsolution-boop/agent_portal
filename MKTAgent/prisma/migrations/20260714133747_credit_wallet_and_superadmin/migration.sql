-- AlterTable
ALTER TABLE "mkt_user" ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mkt_credit_ledger" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "run_id" UUID,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mkt_credit_ledger_owner_id_created_at_idx" ON "mkt_credit_ledger"("owner_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_credit_ledger_run_id_kind_key" ON "mkt_credit_ledger"("run_id", "kind");

-- AddForeignKey
ALTER TABLE "mkt_credit_ledger" ADD CONSTRAINT "mkt_credit_ledger_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
