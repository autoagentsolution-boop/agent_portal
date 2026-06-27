-- CreateTable
CREATE TABLE "mkt_session" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_session_token_hash_key" ON "mkt_session"("token_hash");

-- CreateIndex
CREATE INDEX "ix_session_owner" ON "mkt_session"("owner_id");

-- CreateIndex
CREATE INDEX "ix_session_expires" ON "mkt_session"("expires_at");

-- AddForeignKey
ALTER TABLE "mkt_session" ADD CONSTRAINT "mkt_session_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
