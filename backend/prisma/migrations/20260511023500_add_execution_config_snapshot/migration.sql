-- AlterTable
ALTER TABLE "AgentTemplate" ADD COLUMN     "overridableFieldsJson" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "configOverrideJson" JSONB,
ADD COLUMN     "effectiveConfigJson" JSONB;
