// Seed + smoke test for P1: create a campaign + post via the repos, read back.
// Run: npx tsx prisma/seed.ts
import { createCampaign } from '../src/db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, findCopyGenDue } from '../src/db/repos/post-repo.ts';
import { logRun, prisma } from '../src/db/client.ts';
import { SYSTEM_OWNER_ID } from '../src/db/system-owner.ts';

async function main(): Promise<void> {
  const campaign = await createCampaign({
    ownerId: SYSTEM_OWNER_ID,
    product: 'AgentPortal',
    angle: 'nhấn mạnh tự động đăng bài, sales chỉ duyệt',
    brandContext: 'DAIS — nền tảng & giải pháp công nghệ dễ dùng, triển khai gọn.',
    leadsForm: 'https://forms.gle/ogsWh2pZx2nmG2HE7',
  });

  const post = await createPost({
    campaignId: campaign.id,
    ownerId: campaign.ownerId,
    status: 'brief',
    assetType: 'image',
    driveFolderId: '1KUbt8uiFzhgjGqkVitV7V9Fr6Xhf9E9j',
    heroFile: 'hero.png',
    platforms: ['facebook'],
    lengthSpec: 'long',
  });

  const readBack = await getPostForOwner(post.id, SYSTEM_OWNER_ID);
  const due = await findCopyGenDue();
  await logRun('info', 'seed', { campaignId: campaign.id, postId: post.id });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        campaign: { id: campaign.id, product: campaign.product },
        post: { id: post.id, status: readBack?.status, platforms: readBack?.platforms },
        copyGenDuePicksThisPost: due?.id === post.id,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
