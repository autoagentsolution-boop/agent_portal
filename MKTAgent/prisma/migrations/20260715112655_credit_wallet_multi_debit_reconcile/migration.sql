-- DropIndex
DROP INDEX "mkt_credit_ledger_run_id_kind_key";

-- CreateIndex
CREATE INDEX "mkt_credit_ledger_run_id_kind_idx" ON "mkt_credit_ledger"("run_id", "kind");
