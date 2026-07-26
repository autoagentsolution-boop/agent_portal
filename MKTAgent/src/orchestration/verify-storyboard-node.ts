// Storyboard runner characterization (DRY-RUN, db tier). The storyboard runner is a Phase-3
// media-family split target that NO existing verify exercises through getRunner. This records its
// CURRENT behavior so a decomposition can't silently break it:
//   • the carousel-vs-video deliverable branch (distinctAssetTypes(post).includes('carousel'))
//   • the visual-consistency anchor: first ok frame becomes the anchor, later frames run mode:'edit'
//     conditioned on it
//   • on-frame-text → Pro image model (F1) per frame
//   • a thrown frame is SKIPPED (surviving frames kept), all-fail → throw
//   • carousel post → frames attached as a carousel (CSV of ≥1 local refs)
// No real Gemini/image spend (llmJsonFn + imageFn stubbed). One throwaway tenant.
import { prisma } from '../db/client.ts';
import { getRunner } from './executor/agent-runners.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPostForOwner, getPostByRunId } from '../db/repos/post-repo.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import type { GoalSpec } from './schemas/goal-spec.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Stub the frame-plan LLM: return a fixed 3-frame plan, one frame carrying on-frame TEXT (→ Pro),
// two plain (→ base). Deterministic, no spend.
const framePlanStub = async () => ({
  frames: [
    { index: 0, imagePrompt: 'A steaming cup of coffee on a wooden table, morning light', caption: 'c0' },
    { index: 1, imagePrompt: 'A title card reading "Nắng Sớm" over the cup', caption: 'c1' }, // text → Pro
    { index: 2, imagePrompt: 'The product bag beside the cup', caption: 'c2' },
  ],
});

const goal: GoalSpec = analyzeDeterministic('Make a storyboard carousel for our coffee on facebook');

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `sb-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    // ── CAROUSEL branch: a carousel post → frames attached as carousel, anchor+edit chaining, F1 Pro.
    const camp = await createCampaign({ ownerId: user.id, product: 'Nắng Sớm coffee' });
    const runId = crypto.randomUUID();
    await prisma.workflowRun.create({ data: { id: runId, ownerId: user.id, status: 'running', goal, plan: { nodes: [] } } });
    const post = await createPostForOwner({ campaignId: camp.id, ownerId: user.id, assetType: 'carousel', platforms: ['facebook'], runId });

    // Recording image stub: capture every request so we can assert anchor-edit chaining + per-frame quality.
    const reqs: Array<{ mode?: string; referenceImagePath?: string; quality?: string }> = [];
    let n = 0;
    const imageStub = async (req: { mode?: string; referenceImagePath?: string; quality?: string }) => {
      reqs.push({ mode: req.mode, referenceImagePath: req.referenceImagePath, quality: req.quality });
      n++;
      return { imagePath: `/tmp/f${n}.png`, outputFile: `/tmp/f${n}.png`, cached: false, durationMs: 1 };
    };

    const out = await getRunner('storyboard')({
      runId, ownerId: user.id, goal, upstream: { content_concept: { keyMessage: 'km', mainAngle: 'ma' } },
      postId: post.id, llmJsonFn: framePlanStub as never, imageFn: imageStub as never,
    });

    check('carousel: runner returns a storyboard artifact', out.type === 'storyboard', out.type);
    check('carousel: 3 frames generated', (out.data as { frames?: unknown[] }).frames?.length === 3, (out.data as { frames?: unknown[] }).frames?.length);
    // Anchor + edit chaining: first frame text-to-image (no anchor), later frames mode:'edit' on the anchor.
    check('carousel: first frame is text-to-image (no anchor yet)', reqs[0]?.mode === 'text-to-image', reqs[0]);
    check('carousel: 2nd/3rd frames run in edit mode (anchor conditioning)', reqs[1]?.mode === 'edit' && reqs[2]?.mode === 'edit', reqs.map((r) => r.mode));
    check('carousel: edit frames reference the first frame as anchor', reqs[1]?.referenceImagePath === '/tmp/f1.png', reqs[1]?.referenceImagePath);
    // F1: the text-bearing frame (index 1) requests the Pro model; the plain frames request base.
    check('F1: on-frame-text frame → pro quality', reqs[1]?.quality === 'pro', reqs[1]?.quality);
    check('F1: plain frames → base quality', reqs[0]?.quality === 'base' && reqs[2]?.quality === 'base', reqs.map((r) => r.quality));
    // Carousel deliverable: frames attached to the post as a carousel (CSV of local refs).
    const afterPost = await getPostByRunId(runId);
    const media = (afterPost?.assetMedia ?? null) as Record<string, string> | null;
    check('carousel: frames attached as carousel media (CSV ≥1 local refs)',
      typeof media?.['carousel'] === 'string' && media['carousel'].split(',').every((r) => r.startsWith('local:')),
      media?.['carousel']);

    // ── FRAME-SKIP: a frame whose imageFn throws is skipped; surviving frames are kept (not a hard fail).
    const run2 = crypto.randomUUID();
    await prisma.workflowRun.create({ data: { id: run2, ownerId: user.id, status: 'running', goal, plan: { nodes: [] } } });
    const post2 = await createPostForOwner({ campaignId: camp.id, ownerId: user.id, assetType: 'carousel', platforms: ['facebook'], runId: run2 });
    let calls = 0;
    const flakyImage = async (req: { mode?: string }) => {
      calls++;
      if (calls === 2) throw new Error('image model returned nothing (stub flake)');
      return { imagePath: `/tmp/s${calls}.png`, outputFile: `/tmp/s${calls}.png`, cached: false, durationMs: 1 };
    };
    const out2 = await getRunner('storyboard')({
      runId: run2, ownerId: user.id, goal, upstream: { content_concept: {} },
      postId: post2.id, llmJsonFn: framePlanStub as never, imageFn: flakyImage as never,
    });
    check('frame-skip: one flaky frame skipped, 2 of 3 survive', (out2.data as { frames?: unknown[] }).frames?.length === 2, (out2.data as { frames?: unknown[] }).frames?.length);

    // ── ALL-FAIL: every frame throws → the runner throws (no empty storyboard).
    const run3 = crypto.randomUUID();
    await prisma.workflowRun.create({ data: { id: run3, ownerId: user.id, status: 'running', goal, plan: { nodes: [] } } });
    const post3 = await createPostForOwner({ campaignId: camp.id, ownerId: user.id, assetType: 'carousel', platforms: ['facebook'], runId: run3 });
    const deadImage = async () => { throw new Error('every frame fails'); };
    let threw = false;
    try {
      await getRunner('storyboard')({ runId: run3, ownerId: user.id, goal, upstream: { content_concept: {} }, postId: post3.id, llmJsonFn: framePlanStub as never, imageFn: deadImage as never });
    } catch { threw = true; }
    check('all-fail: runner throws when no frame renders', threw);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — storyboard runner characterized (carousel branch, anchor-edit, F1 Pro, frame-skip)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
