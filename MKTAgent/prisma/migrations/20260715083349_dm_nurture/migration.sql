-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('whatsapp', 'telegram', 'zalo');

-- CreateEnum
CREATE TYPE "DmOptInState" AS ENUM ('none', 'opted_in', 'expired');

-- CreateTable
CREATE TABLE "mkt_dm_contact" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_id_bidx" TEXT NOT NULL,
    "opt_in_state" "DmOptInState" NOT NULL DEFAULT 'none',
    "opt_in_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_dm_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_dm_message" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "run_id" UUID NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'out',
    "status" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "body_enc" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_dm_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_dm_contact_owner" ON "mkt_dm_contact"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_dm_contact_owner_id_channel_external_id_bidx_key" ON "mkt_dm_contact"("owner_id", "channel", "external_id_bidx");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_dm_message_run_id_key" ON "mkt_dm_message"("run_id");

-- CreateIndex
CREATE INDEX "ix_dm_message_contact" ON "mkt_dm_message"("contact_id");

-- CreateIndex
CREATE INDEX "ix_dm_message_owner" ON "mkt_dm_message"("owner_id");

-- AddForeignKey
ALTER TABLE "mkt_dm_contact" ADD CONSTRAINT "mkt_dm_contact_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_dm_message" ADD CONSTRAINT "mkt_dm_message_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_dm_message" ADD CONSTRAINT "mkt_dm_message_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "mkt_dm_contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
