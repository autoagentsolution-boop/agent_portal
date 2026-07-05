-- AlterTable
ALTER TABLE "mkt_campaign" ADD COLUMN     "product_knowledge_id" UUID;

-- AlterTable
ALTER TABLE "mkt_post" ADD COLUMN     "product_knowledge_id" UUID;

-- CreateTable
CREATE TABLE "mkt_product_knowledge" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "product_details" TEXT NOT NULL,
    "profile" JSONB,
    "brand_voice" TEXT,
    "language" TEXT,
    "source_docs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_product_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pk_owner" ON "mkt_product_knowledge"("owner_id");

-- CreateIndex
CREATE INDEX "ix_campaign_pk" ON "mkt_campaign"("product_knowledge_id");

-- CreateIndex
CREATE INDEX "ix_post_pk" ON "mkt_post"("product_knowledge_id");

-- AddForeignKey
ALTER TABLE "mkt_campaign" ADD CONSTRAINT "mkt_campaign_product_knowledge_id_fkey" FOREIGN KEY ("product_knowledge_id") REFERENCES "mkt_product_knowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_post" ADD CONSTRAINT "mkt_post_product_knowledge_id_fkey" FOREIGN KEY ("product_knowledge_id") REFERENCES "mkt_product_knowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_product_knowledge" ADD CONSTRAINT "mkt_product_knowledge_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
