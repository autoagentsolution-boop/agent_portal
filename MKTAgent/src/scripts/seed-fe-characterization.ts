// FE characterization seed (Phase-0 agent-browser sub-phase). Mints a throwaway tenant with the
// data the 4 P0 journeys need, grants trial credits (so runs don't 402), flags super-admin (so the
// URL-gated console renders), and seeds TWO campaigns each with a post — the postboard-merge journey
// needs cross-campaign posts to prove mergePosts merge-not-replace. Prints USERID + COOKIE.
//   npx tsx src/scripts/seed-fe-characterization.ts            → mint + print
//   npx tsx src/scripts/seed-fe-characterization.ts --cleanup <userId>
import { prisma } from '../db/client.ts';
import { createSession } from '../lib/session.ts';
import { createLead } from '../db/repos/lead-repo.ts';
import { createInstruction } from '../db/repos/instruction-repo.ts';
import { rememberKeyed } from '../db/repos/user-memory-repo.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPost } from '../db/repos/post-repo.ts';
import { ensureTrialGrant } from '../db/repos/credit-repo.ts';

async function cleanup(userId: string): Promise<void> {
  await prisma.post.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.campaign.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.userMemory.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.instruction.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.creditLedger.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.session.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.agentChatSession.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.workflowRun.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  console.log(`cleaned up ${userId}`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--cleanup' && process.argv[3]) { await cleanup(process.argv[3]!); process.exit(0); }

  const user = await prisma.user.create({
    data: {
      email: `fe-char-${Date.now()}@test.local`,
      defaultLanguage: 'en',
      accountType: 'business',
      brandVoice: 'Warm, expert, concise',
      isSuperAdmin: true, // super-admin URL-gate journey renders the console
    },
  });
  await ensureTrialGrant(user.id); // credits so execute doesn't 402

  await createLead({ ownerId: user.id, name: 'Nghiep', email: 'nghiep.demo@gmail.com', phone: null, message: 'Interested in the automation course', sourceProduct: 'AI Automation Course', source: 'form', calBookingUid: null, score: 72, scoreReasons: [] });
  await createInstruction({ ownerId: user.id, scope: 'workspace', agentId: null, content: 'Always use a witty, punchy tone and target SME founders in Southeast Asia.' });
  await rememberKeyed(user.id, 'product', 'ai automation course', 'AI Automation Course: teaches founders to automate ops with AI agents', user.id);

  // Two campaigns, each with a brief post — the postboard-merge journey opens A→B→A and asserts A's
  // card survives (mergePosts merges by id, never replaces the global set).
  const campA = await createCampaign({ ownerId: user.id, product: 'Alpha Launch', active: true });
  const campB = await createCampaign({ ownerId: user.id, product: 'Beta Launch', active: true });
  await createPost({ ownerId: user.id, campaignId: campA.id, status: 'brief', assetType: 'image', platforms: ['facebook'] });
  await createPost({ ownerId: user.id, campaignId: campB.id, status: 'brief', assetType: 'image', platforms: ['facebook'] });

  const { handle } = await createSession(user.id, 'agent-browser-fe-char');
  console.log(`USERID=${user.id}`);
  console.log(`CAMPAIGN_A=${campA.id}`);
  console.log(`CAMPAIGN_B=${campB.id}`);
  console.log(`COOKIE=${handle}`);
  process.exit(0);
}

void main();
