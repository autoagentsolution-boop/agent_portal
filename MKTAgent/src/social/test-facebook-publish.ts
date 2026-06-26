// Manual FB publish smoke test (P2 verification). Posts REAL content to the DAIS
// page via the adapter, reading the token from the encrypted DB store.
//   npx tsx src/social/test-facebook-publish.ts image
//   npx tsx src/social/test-facebook-publish.ts carousel
//   npx tsx src/social/test-facebook-publish.ts video
import { facebookAdapter } from './facebook.ts';
import { prisma } from '../db/client.ts';
import type { PublishInput } from './types.ts';

// Real Drive fileIds (from the shared test folder 1KUbt8...).
const HERO = '1bo4diy3vlH9VmRE-78Z15ux9053-KZci'; // hero.png
const AGENTFLOW = '1hOO9vnXFqZuUIdGy8DK52jnFjdnwv_at'; // agentflow.png
const VIDEO = '1EZ8rxIvdQICS2q8sBincrn2lj3FSxTFq'; // bo-kho-v2.mp4

const COPY = {
  copyVi: '[MKTAgent test] Tự động đăng bài — sales chỉ duyệt. 🚀 #DAIS',
  copyEn: '[MKTAgent test] Automated posting. #DAIS',
  copyThreads: '',
  copyX: '',
};

const mode = process.argv[2] ?? 'image';

const inputs: Record<string, PublishInput> = {
  image: { postId: 'test-img', assetType: 'image', assets: [{ id: HERO }], ...COPY },
  carousel: {
    postId: 'test-car',
    assetType: 'carousel',
    assets: [{ id: AGENTFLOW }, { id: HERO }],
    ...COPY,
  },
  video: { postId: 'test-vid', assetType: 'video', assets: [{ id: VIDEO }], ...COPY },
};

async function main(): Promise<void> {
  const input = inputs[mode];
  if (!input) throw new Error(`unknown mode ${mode} (image|carousel|video)`);
  const result = await facebookAdapter.publish(input);
  console.log(JSON.stringify({ mode, result }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
