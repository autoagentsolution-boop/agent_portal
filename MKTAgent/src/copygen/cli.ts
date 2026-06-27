// Copy-gen CLI for ops + verification.
//   npx tsx src/copygen/cli.ts tick        # run ONE real tick (calls Gemini, spends tokens)
//   npx tsx src/copygen/cli.ts dry-tick    # full tick with a STUB Gemini response (no API)
//   npx tsx src/copygen/cli.ts seed-test   # create a campaign + brief Post to generate
//   npx tsx src/copygen/cli.ts prompt      # print the built prompt for the next due row (no call)
import { runCopyGenTick } from './service.ts';
import { buildGeminiBody } from './prompt.ts';
import { createPost, findCopyGenDueWithCampaign } from '../db/repos/post-repo.ts';
import { prisma } from '../db/client.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';

// Deterministic stub mimicking a valid Gemini structured-JSON response.
const stubGemini = async (): Promise<unknown> => ({
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        parts: [
          {
            text: JSON.stringify({
              body: 'Hook thử nghiệm ngắn\n\nThân bài nói kết quả vận hành.\n\nBạn xử lý việc này thế nào?\n#DAIS #Automation',
              threads: 'Short test hook for Threads. Real outcome in one line. Try it. #DAIS',
              x: 'Short test hook. One value line. link in bio #DAIS',
            }),
          },
        ],
      },
    },
  ],
});

async function seedTest(): Promise<void> {
  const c = await prisma.campaign.create({
    data: { ownerId: SYSTEM_OWNER_ID, product: 'copygen-smoke-test', angle: 'nhấn lợi ích vận hành', active: true },
  });
  const p = await createPost({ campaignId: c.id, ownerId: c.ownerId, status: 'brief', assetType: 'image', lengthSpec: 'short' });
  console.log(JSON.stringify({ campaignId: c.id, postId: p.id, status: p.status }, null, 2));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'tick') {
    console.log(JSON.stringify(await runCopyGenTick(), null, 2));
  } else if (cmd === 'dry-tick') {
    console.log(JSON.stringify(await runCopyGenTick(stubGemini), null, 2));
  } else if (cmd === 'seed-test') {
    await seedTest();
  } else if (cmd === 'prompt') {
    const post = await findCopyGenDueWithCampaign();
    if (!post) {
      console.log('no due row');
    } else {
      const body = buildGeminiBody(post);
      console.log(body.systemInstruction.parts[0]?.text ?? '');
      console.log('\n--- USER ---\n');
      console.log(body.contents[0]?.parts[0]?.text ?? '');
    }
  } else {
    console.error('usage: cli.ts <tick|dry-tick|seed-test|prompt>');
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
