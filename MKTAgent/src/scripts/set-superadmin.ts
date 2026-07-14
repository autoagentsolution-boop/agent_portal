// One-off bootstrap: flip a user's isSuperAdmin flag by email (credit-wallet Phase 01).
// The super-admin operates /superadminatria101 (grant credits, review capability requests).
//   npx tsx src/scripts/set-superadmin.ts auto.agent.solution@gmail.com [--revoke]
import { prisma } from '../db/client.ts';

const main = async (): Promise<void> => {
  const email = process.argv[2];
  const revoke = process.argv.includes('--revoke');
  if (!email) {
    console.error('usage: tsx src/scripts/set-superadmin.ts <email> [--revoke]');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`no user with email ${email} (they must have logged in at least once)`);
    process.exit(1);
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isSuperAdmin: !revoke },
  });
  console.log(`${email} → isSuperAdmin=${updated.isSuperAdmin}`);
  await prisma.$disconnect();
};

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
