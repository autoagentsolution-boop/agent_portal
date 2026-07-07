-- CreateTable
CREATE TABLE "mkt_roadmap_demand" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "signal" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_roadmap_demand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_roadmap_demand_owner_agent" ON "mkt_roadmap_demand"("owner_id", "agent_id");

-- AddForeignKey
ALTER TABLE "mkt_roadmap_demand" ADD CONSTRAINT "mkt_roadmap_demand_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
