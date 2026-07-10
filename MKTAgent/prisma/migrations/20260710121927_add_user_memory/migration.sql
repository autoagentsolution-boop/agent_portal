-- CreateTable
CREATE TABLE "mkt_memory" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT,
    "content" TEXT NOT NULL,
    "source_session_id" UUID,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mkt_memory_owner_id_idx" ON "mkt_memory"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_memory_owner_id_kind_key_key" ON "mkt_memory"("owner_id", "kind", "key");

-- AddForeignKey
ALTER TABLE "mkt_memory" ADD CONSTRAINT "mkt_memory_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
