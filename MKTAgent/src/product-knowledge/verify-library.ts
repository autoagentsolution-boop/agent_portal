// Product Knowledge library (item 6) — DB-backed. Exercises repo CRUD, the merge (append)
// semantics, the linked-knowledge resolution precedence, and the SetNull-on-delete FK.
// No Gemini/network. Run: npx tsx src/product-knowledge/verify-library.ts
import { prisma } from '../db/client.ts';
import {
  createProductKnowledge,
  listProductKnowledge,
  getProductKnowledge,
  updateProductKnowledge,
  mergeProductKnowledge,
  deleteProductKnowledge,
  resolveLinkedKnowledge,
} from '../db/repos/product-knowledge-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `pk-${Date.now()}@test.local` } });
  try {
    // 1) create / list / get
    const pk = await createProductKnowledge({
      ownerId: user.id, name: 'Water Filter', productDetails: 'Smart water filter for families.',
      profile: { summary: 'filter' }, brandVoice: 'Trustworthy', language: 'en', sourceDocs: ['spec.pdf'],
    });
    check('create returns entry', Boolean(pk.id) && pk.name === 'Water Filter', pk);
    const list = await listProductKnowledge(user.id);
    check('list includes the entry', list.some((e) => e.id === pk.id), list.length);
    const got = await getProductKnowledge(pk.id, user.id);
    check('get by id (owner-scoped)', got?.id === pk.id, got);
    const other = await prisma.user.create({ data: { email: `pk-other-${Date.now()}@test.local` } });
    check('get wrong tenant → null', (await getProductKnowledge(pk.id, other.id)) === null);
    await prisma.user.delete({ where: { id: other.id } }).catch(() => {});

    // 2) update
    const upd = await updateProductKnowledge(pk.id, user.id, { name: 'Water Filter Pro' });
    check('update name', upd?.name === 'Water Filter Pro', upd?.name);

    // 3) merge appends details + docs, refreshes voice/language
    const merged = await mergeProductKnowledge(pk.id, user.id, {
      productDetails: 'New: removes 99% bacteria.', sourceDocs: ['lab.pdf'], language: 'vi',
    });
    check('merge appends productDetails', /Smart water filter/.test(merged?.productDetails ?? '') && /99% bacteria/.test(merged?.productDetails ?? ''), merged?.productDetails);
    check('merge unions sourceDocs', (merged?.sourceDocs ?? []).includes('spec.pdf') && (merged?.sourceDocs ?? []).includes('lab.pdf'), merged?.sourceDocs);
    check('merge refreshes language', merged?.language === 'vi', merged?.language);

    // 4) resolution precedence: post link wins over campaign link; campaign used when post null.
    const pk2 = await createProductKnowledge({ ownerId: user.id, name: 'Other', productDetails: 'Other product facts.' });
    const both = await resolveLinkedKnowledge(user.id, pk2.id, pk.id);
    check('post link wins over campaign link', /Other product facts/.test(both ?? ''), both);
    const campOnly = await resolveLinkedKnowledge(user.id, null, pk.id);
    check('campaign link used when no post link', /Smart water filter/.test(campOnly ?? ''), campOnly);
    check('neither linked → null', (await resolveLinkedKnowledge(user.id, null, null)) === null);

    // 5) SetNull on delete: a campaign linked to an entry has its FK nulled when the entry is deleted.
    const campaign = await prisma.campaign.create({ data: { ownerId: user.id, product: 'X', platforms: ['facebook'], productKnowledgeId: pk2.id } });
    check('campaign linked to entry', campaign.productKnowledgeId === pk2.id, campaign.productKnowledgeId);
    const del = await deleteProductKnowledge(pk2.id, user.id);
    check('delete returns true', del === true);
    const after = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    check('campaign FK set null after entry delete (content survives)', after !== null && after.productKnowledgeId === null, after?.productKnowledgeId);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(failures === 0 ? '\nPASS — product knowledge library checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
