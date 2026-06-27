// Token CLI for ops + verification.
//   npx tsx src/tokens/cli.ts seed [ownerId]  # import env tokens → encrypted DB
//                                              # (default owner = system/DAIS)
//   npx tsx src/tokens/cli.ts maintain        # refresh-ahead + liveness, all tenants
//   npx tsx src/tokens/cli.ts status          # show stored tokens (NO plaintext)
import { seedTokensFromEnv, runTokenMaintenance } from './service.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import { prisma } from '../db/client.ts';

const cmd = process.argv[2];

async function main(): Promise<void> {
  if (cmd === 'seed') {
    const ownerId = process.argv[3] || SYSTEM_OWNER_ID;
    const seeded = await seedTokensFromEnv(ownerId);
    console.log(JSON.stringify({ ownerId, seeded }, null, 2));
  } else if (cmd === 'maintain') {
    const summary = await runTokenMaintenance();
    console.log(JSON.stringify(summary, null, 2));
  } else if (cmd === 'status') {
    const rows = await prisma.oAuthToken.findMany({
      select: { ownerId: true, platform: true, status: true, expiresAt: true, lastCheckedAt: true, updatedAt: true },
    });
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.error('usage: cli.ts <seed [ownerId]|maintain|status>');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
