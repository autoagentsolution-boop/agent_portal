// Verify the concept edit-loss fix: a re-run of concept_writer must PRESERVE user-modified copy
// (copyEdited) instead of regenerating over it. Creates one throwaway tenant, cleans up after.
import { prisma } from '../db/client.ts';
import { createCampaign } from '../db/repos/campaign-repo.ts';
import { createPost, getPostForOwner, editPostCopy } from '../db/repos/post-repo.ts';
import { getRunner } from './executor/agent-runners.ts';
import { goalSpec } from './schemas/goal-spec.ts';
import type { GeminiFn } from '../copygen/service.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// A stub copy-gen that returns DISTINCT copy — if it runs, the user edit was overwritten.
const stubGemini: GeminiFn = async () => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ variants: [
    { body: 'REGENERATED body', threads: 'regen threads', x: 'regen x' },
    { body: 'REGENERATED body 2', threads: 'regen threads 2', x: 'regen x 2' },
  ] }) }] } }],
});

const goal = goalSpec.parse({ outputs: { needsTextPost: true }, platforms: ['facebook'], slots: { product: 'Test product', productDetails: 'a product for verification' }, provider: 'test' });
const USER_COPY = { body: 'USER EDITED body', threads: 'user threads', x: 'user x' };

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `edit-loss-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const runId = (await prisma.workflowRun.create({ data: { ownerId: user.id, status: 'running', goal, plan: { nodes: [] } } })).id;
    const campaign = await createCampaign({ ownerId: user.id, product: 'Test product', platforms: ['facebook'] });
    const mkPost = async () => {
      const p = await createPost({ campaignId: campaign.id, ownerId: user.id, runId, status: 'brief', platforms: ['facebook'] });
      // Move to review + seed generated copy, then apply a USER edit (sets copyEdited=true).
      await prisma.post.update({ where: { id: p.id }, data: { status: 'review', copy: { body: 'generated', threads: 't', x: 'x' } } });
      await editPostCopy(p.id, user.id, USER_COPY);
      return p.id;
    };
    const runConcept = (postId: string) => getRunner('concept_writer')({ runId, ownerId: user.id, goal, upstream: {}, postId, geminiFn: stubGemini });

    // 1) edit-copy sets copyEdited.
    const p1 = await mkPost();
    const edited = await getPostForOwner(p1, user.id);
    ck('edit-copy sets copyEdited=true', edited?.copyEdited === true, edited?.copyEdited);

    // 2) PRESERVE: re-running concept on an edited post keeps the user copy, does NOT regenerate.
    const out1 = await runConcept(p1);
    const copy1 = (out1.data as { copy?: { body?: string } }).copy;
    ck('re-run preserves user copy (artifact)', copy1?.body === USER_COPY.body, copy1?.body);
    ck('preserve path has no LLM cost', out1.cost === undefined, out1.cost);
    const afterPost = await getPostForOwner(p1, user.id);
    ck('post.copy still the user edit', (afterPost?.copy as { body?: string })?.body === USER_COPY.body, (afterPost?.copy as { body?: string })?.body);
    ck('status not reset to brief', afterPost?.status !== 'brief', afterPost?.status);

    // 3) REGENERATE when NOT edited: clear the flag → concept regenerates fresh copy.
    const p2 = await mkPost();
    await prisma.post.update({ where: { id: p2 }, data: { copyEdited: false } });
    const out2 = await runConcept(p2);
    ck('unedited post regenerates', (out2.data as { copy?: { body?: string } }).copy?.body === 'REGENERATED body', (out2.data as { copy?: { body?: string } }).copy?.body);

    // 4) REGENERATE on explicit rework even if edited (user asked for new copy).
    const p3 = await mkPost();
    await prisma.post.update({ where: { id: p3 }, data: { status: 'rework' } });
    const out3 = await runConcept(p3);
    ck('rework regenerates despite copyEdited', (out3.data as { copy?: { body?: string } }).copy?.body === 'REGENERATED body', (out3.data as { copy?: { body?: string } }).copy?.body);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log('cleanup: throwaway tenant removed');
  }
}

await main();
console.log(failures ? `\nFAIL — ${failures} edit-loss check(s) red` : '\nPASS — concept edit-loss fix works');
process.exit(failures ? 1 : 0);
