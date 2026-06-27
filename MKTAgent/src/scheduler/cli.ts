// Scheduler CLI for ops + verification.
//   npx tsx src/scheduler/cli.ts tick        # run ONE real tick (LIVE — posts!)
//   npx tsx src/scheduler/cli.ts dry-tick    # full tick with stub publish (NO posts)
//   npx tsx src/scheduler/cli.ts seed-test   # create a campaign + ready Post due now
//   npx tsx src/scheduler/cli.ts status       # list non-terminal posts
//
// dry-tick honors the DRY-RUN-only rule: it exercises lock → claim → aggregate →
// write-back end-to-end against a real DB row, but the platform calls are stubbed
// so nothing hits Meta/LinkedIn/X.
import { runSchedulerTick } from './tick.ts';
import { createPost } from '../db/repos/post-repo.ts';
import { prisma } from '../db/client.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import type { PublishInput, PublishResult } from '../social/types.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

const stubPublish = async (platform: SocialPlatform, input: PublishInput): Promise<PublishResult> => ({
  platform,
  ok: true,
  url: `https://example.test/${platform}/${input.postId}`,
  error: null,
});

async function seedTest(): Promise<void> {
  const campaign = await prisma.campaign.create({
    data: { ownerId: SYSTEM_OWNER_ID, product: 'scheduler-smoke-test', angle: 'P3 verify', active: true },
  });
  const post = await createPost({
    campaignId: campaign.id,
    ownerId: campaign.ownerId,
    status: 'ready',
    assetType: 'image',
    language: 'vi',
    copy: { body: 'Bài test scheduler (dry-run)', threads: 'Scheduler smoke test', x: 'Scheduler smoke test' },
    heroFile: '1bo4diy3vlH9VmRE-78Z15ux9053-KZci',
    platforms: ['facebook', 'instagram'],
    scheduledAt: new Date(Date.now() - 60_000),
  });
  console.log(JSON.stringify({ campaignId: campaign.id, postId: post.id, status: post.status }, null, 2));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'tick') {
    console.log(JSON.stringify(await runSchedulerTick(), null, 2));
  } else if (cmd === 'dry-tick') {
    console.log(JSON.stringify(await runSchedulerTick(stubPublish), null, 2));
  } else if (cmd === 'seed-test') {
    await seedTest();
  } else if (cmd === 'status') {
    const rows = await prisma.post.findMany({
      where: { status: { in: ['brief', 'review', 'rework', 'ready', 'posting'] } },
      select: { id: true, status: true, platforms: true, scheduledAt: true, assetType: true },
      orderBy: { scheduledAt: 'asc' },
    });
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.error('usage: cli.ts <tick|dry-tick|seed-test|status>');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
