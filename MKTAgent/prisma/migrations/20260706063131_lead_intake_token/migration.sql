-- CreateTable
CREATE TABLE "mkt_lead_intake_token" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "mkt_lead_intake_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_lead_intake_token_token_hash_key" ON "mkt_lead_intake_token"("token_hash");

-- CreateIndex
CREATE INDEX "ix_lead_intake_owner" ON "mkt_lead_intake_token"("owner_id");

-- AddForeignKey
ALTER TABLE "mkt_lead_intake_token" ADD CONSTRAINT "mkt_lead_intake_token_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
