-- CreateEnum
CREATE TYPE "InstructionScope" AS ENUM ('workspace', 'campaign', 'post');

-- CreateEnum
CREATE TYPE "InstructionSource" AS ENUM ('user', 'memory');

-- CreateTable
CREATE TABLE "mkt_instruction" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "scope" "InstructionScope" NOT NULL,
    "scope_ref_id" UUID,
    "agent_id" TEXT,
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "InstructionSource" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_instruction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_instruction_owner_scope" ON "mkt_instruction"("owner_id", "scope");

-- CreateIndex
CREATE INDEX "ix_instruction_scope_ref" ON "mkt_instruction"("owner_id", "scope", "scope_ref_id");

-- AddForeignKey
ALTER TABLE "mkt_instruction" ADD CONSTRAINT "mkt_instruction_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
