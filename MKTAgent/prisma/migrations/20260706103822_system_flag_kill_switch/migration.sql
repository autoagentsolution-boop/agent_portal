-- CreateTable
CREATE TABLE "mkt_system_flag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_system_flag_pkey" PRIMARY KEY ("key")
);
