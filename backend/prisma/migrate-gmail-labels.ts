import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const agents = await prisma.agentInstance.findMany({
    where: { templateId: 'gmail-lead-classifier' },
  });

  let migrated = 0;
  let skipped = 0;
  for (const a of agents) {
    const cfg = (a.configJson ?? {}) as Record<string, unknown>;
    const hasLegacy = typeof cfg.gmail_label === 'string';
    const hasNew = Array.isArray(cfg.gmail_labels) && cfg.gmail_labels.length > 0;

    if (!hasLegacy && hasNew) {
      skipped++;
      continue;
    }
    if (!hasLegacy && !hasNew) {
      skipped++;
      continue;
    }

    const next: Record<string, unknown> = { ...cfg };
    if (!hasNew) {
      next.gmail_labels = [cfg.gmail_label as string];
    }
    delete next.gmail_label;

    await prisma.agentInstance.update({
      where: { id: a.id },
      data: { configJson: next as object },
    });
    migrated++;
  }

  console.log(
    `gmail_label → gmail_labels migration: scanned=${agents.length} migrated=${migrated} skipped=${skipped}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
