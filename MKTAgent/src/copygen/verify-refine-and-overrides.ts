// Phase 5 verification — text-refine + per-post voice/angle overrides (no real Gemini
// spend: the LLM call is stubbed). Proves:
//   • refineForPost edits existing copy on a review post (stays review), stubbed LLM
//     receives the refine directive + current copy in the prompt.
//   • per-post angle overrides campaign.angle in the built prompt.
//   • per-post brandVoice overrides campaign.brandVoice in resolveCopyConfig.
//   • refine refuses a brief post (not_refinable) and a post with no copy.
import { prisma } from '../db/client.ts';
import { getPostForCopyGen } from '../db/repos/post-repo.ts';
import { refineForPost, type GeminiFn } from './service.ts';
import { buildGeminiBody } from './prompt.ts';
import { resolveCopyConfig } from './resolve-config.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `rf-${Date.now()}@test.local`, defaultLanguage: 'en', brandVoice: 'User default voice' } });
  try {
    const campaign = await prisma.campaign.create({
      data: { ownerId: user.id, product: 'AI suite', angle: 'Campaign angle', brandVoice: 'Campaign voice', platforms: ['facebook'] },
    });
    const post = await prisma.post.create({
      data: {
        campaignId: campaign.id, ownerId: user.id, status: 'review', platforms: ['facebook'],
        angle: 'Per-post angle OVERRIDE', brandVoice: 'Per-post voice OVERRIDE',
        copy: { body: 'Original body', threads: 'Original threads', x: 'Original x' },
      },
    });

    // Per-post override resolution.
    const withCampaign = await getPostForCopyGen(post.id, user.id);
    const cfg = resolveCopyConfig(withCampaign!);
    check('resolveCopyConfig uses per-post brandVoice override', cfg.brandVoice === 'Per-post voice OVERRIDE', cfg.brandVoice);

    // Per-post angle lands in the prompt.
    const body = buildGeminiBody(withCampaign!);
    const userMsg = body.contents[0]?.parts[0]?.text ?? '';
    check('prompt uses per-post angle override', userMsg.includes('Per-post angle OVERRIDE'), userMsg.slice(0, 120));

    // Refine directive: stub LLM asserts it sees the instruction + current copy, returns new copy.
    let sawInstruction = false;
    let sawCurrent = false;
    const stub: GeminiFn = async (b) => {
      const txt = b.contents[0]?.parts[0]?.text ?? '';
      sawInstruction = txt.includes('add a limited-time discount');
      sawCurrent = txt.includes('Original body');
      return { candidates: [{ content: { parts: [{ text: JSON.stringify({ body: 'Refined body with discount', threads: 'Refined threads', x: 'Refined x' }) }] } }] };
    };
    const r = await refineForPost(post.id, user.id, 'add a limited-time discount', stub);
    check('refine returns review', r.status === 'review', r);
    check('stub prompt carried the instruction', sawInstruction);
    check('stub prompt carried the current copy', sawCurrent);

    const after = await prisma.post.findFirst({ where: { id: post.id } });
    check('copy updated to refined body', (after?.copy as { body?: string })?.body === 'Refined body with discount', after?.copy);
    check('post stays in review after refine', after?.status === 'review', after?.status);

    // Refuses a brief post (no copy path exercised via a fresh brief).
    const brief = await prisma.post.create({ data: { campaignId: campaign.id, ownerId: user.id, status: 'brief', platforms: ['facebook'] } });
    const rBrief = await refineForPost(brief.id, user.id, 'x', stub);
    check('refine refuses a brief post (not_refinable)', rBrief.reason === 'not_refinable', rBrief);
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
  console.log(failures === 0 ? '\nPASS — refine + per-post overrides green (0 Gemini spend)' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
