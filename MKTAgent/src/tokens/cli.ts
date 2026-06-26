// Token CLI for ops + verification.
//   npx tsx src/tokens/cli.ts seed        # import env tokens → encrypted DB
//   npx tsx src/tokens/cli.ts maintain    # refresh-ahead + liveness, print summary
//   npx tsx src/tokens/cli.ts status      # show stored tokens (NO plaintext)
import { seedTokensFromEnv, runTokenMaintenance } from './service.ts';
import { prisma } from '../db/client.ts';

const cmd = process.argv[2];

async function main(): Promise<void> {
  if (cmd === 'seed') {
    const seeded = await seedTokensFromEnv();
    console.log(JSON.stringify({ seeded }, null, 2));
  } else if (cmd === 'maintain') {
    const summary = await runTokenMaintenance();
    console.log(JSON.stringify(summary, null, 2));
  } else if (cmd === 'status') {
    const rows = await prisma.oAuthToken.findMany({
      select: { platform: true, status: true, expiresAt: true, lastCheckedAt: true, updatedAt: true },
    });
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.error('usage: cli.ts <seed|maintain|status>');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
