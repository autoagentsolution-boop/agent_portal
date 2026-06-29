-- CreateTable
CREATE TABLE "wf_run" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "chat_session_id" UUID,
    "goal" JSONB NOT NULL,
    "plan" JSONB,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wf_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_node_run" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "depends_on" TEXT[],
    "input_refs" TEXT[],
    "output_refs" TEXT[],
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "wf_node_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_artifact" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wf_artifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_wf_run_owner_status" ON "wf_run"("owner_id", "status");

-- CreateIndex
CREATE INDEX "ix_wf_node_run" ON "wf_node_run"("run_id");

-- CreateIndex
CREATE INDEX "ix_wf_artifact_run_type" ON "wf_artifact"("run_id", "type");

-- AddForeignKey
ALTER TABLE "wf_run" ADD CONSTRAINT "wf_run_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_node_run" ADD CONSTRAINT "wf_node_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "wf_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wf_artifact" ADD CONSTRAINT "wf_artifact_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "wf_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
