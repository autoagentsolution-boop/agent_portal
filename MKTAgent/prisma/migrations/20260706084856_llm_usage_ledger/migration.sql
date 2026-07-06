-- CreateTable
CREATE TABLE "mkt_llm_usage" (
    "id" BIGSERIAL NOT NULL,
    "owner_id" UUID,
    "surface" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "thought_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "run_id" UUID,
    "ref_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_llm_usage_owner" ON "mkt_llm_usage"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_llm_usage_surface" ON "mkt_llm_usage"("owner_id", "surface");
