-- CreateTable
CREATE TABLE "agent_chat_session" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "draft" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_chat_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_chat_message" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_credential" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_agent_chat_owner_updated" ON "agent_chat_session"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ix_agent_chat_message_session_created" ON "agent_chat_message"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_agent_credential_owner" ON "agent_credential"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_credential_owner_id_agent_id_key_key" ON "agent_credential"("owner_id", "agent_id", "key");

-- AddForeignKey
ALTER TABLE "agent_chat_session" ADD CONSTRAINT "agent_chat_session_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_chat_message" ADD CONSTRAINT "agent_chat_message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_chat_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_credential" ADD CONSTRAINT "agent_credential_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
