// Atria Phase 02 verification — Memory facade (profile-facade.ts). Two layers:
// (1) pure — the toProductProfile mapper against fake rows, no DB required;
// (2) DB-backed — getProfile/getProduct/remember round-trip + owner isolation
// against real Postgres, when reachable. If Postgres is unavailable in this
// run, the DB layer SKIPS with a clear message (exit 0) rather than failing —
// mirrors how other verify-* scripts assume `docker compose up -d postgres`,
// but this one is meant to also run standalone.
import { prisma } from '../db/client.ts';
import { getProfile, getProduct, remember, toProductProfile } from '../memory/profile-facade.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// ---------- (1) Pure: mapper correctness, no DB ----------
console.log('Pure: toProductProfile mapping');

{
  const row = {
    id: 'pk-1',
    name: 'Widget Pro',
    productDetails: 'Full grounding paragraph about Widget Pro.',
    profile: {
      productSummary: 'A pro widget for makers.',
      differentiators: 'Only widget with X.',
      targetAudience: 'Hobbyist makers.',
      proofPoints: '10k units sold.',
    },
    brandVoice: 'Friendly and direct',
    language: 'en',
  };
  const mapped = toProductProfile(row);
  check('id mapped', mapped.id === 'pk-1', mapped);
  check('name mapped', mapped.name === 'Widget Pro', mapped);
  check('summary from structured profile', mapped.summary === 'A pro widget for makers.', mapped.summary);
  check('differentiators mapped', mapped.differentiators === 'Only widget with X.', mapped.differentiators);
  check('targetAudience mapped', mapped.targetAudience === 'Hobbyist makers.', mapped.targetAudience);
  check('proofPoints mapped', mapped.proofPoints === '10k units sold.', mapped.proofPoints);
  check('brandVoice mapped', mapped.brandVoice === 'Friendly and direct', mapped.brandVoice);
  check('language mapped', mapped.language === 'en', mapped.language);
}

{
  // No structured profile at all -> summary falls back to productDetails; the
  // rest stay null (nothing to derive them from).
  const row = {
    id: 'pk-2',
    name: 'Bare Entry',
    productDetails: 'Just a raw paragraph, no structured extraction yet.',
    profile: null,
    brandVoice: null,
    language: null,
  };
  const mapped = toProductProfile(row);
  check('summary falls back to productDetails when profile is null', mapped.summary === 'Just a raw paragraph, no structured extraction yet.', mapped.summary);
  check('differentiators null when absent', mapped.differentiators === null, mapped.differentiators);
  check('targetAudience null when absent', mapped.targetAudience === null, mapped.targetAudience);
  check('proofPoints null when absent', mapped.proofPoints === null, mapped.proofPoints);
  check('brandVoice null when absent', mapped.brandVoice === null, mapped.brandVoice);
}

{
  // Partial structured profile (only productSummary present) -> the rest null,
  // not accidentally inherited from productDetails.
  const row = {
    id: 'pk-3',
    name: 'Partial Entry',
    productDetails: 'Detail paragraph.',
    profile: { productSummary: 'Only a summary was extracted.' },
    brandVoice: null,
    language: null,
  };
  const mapped = toProductProfile(row);
  check('partial profile: summary used', mapped.summary === 'Only a summary was extracted.', mapped.summary);
  check('partial profile: differentiators null', mapped.differentiators === null, mapped.differentiators);
}

// ---------- (2) DB-backed: real round-trip, if Postgres is reachable ----------
async function dbChecks(): Promise<void> {
  console.log('\nDB: getProfile / getProduct / remember round-trip');

  const ownerA = await prisma.user.create({
    data: { email: `memory-a-${Date.now()}@test.local`, defaultLanguage: 'en', brandVoice: 'Bold and playful' },
  });
  const ownerB = await prisma.user.create({
    data: { email: `memory-b-${Date.now()}@test.local` },
  });

  try {
    const pk = await prisma.productKnowledge.create({
      data: {
        ownerId: ownerA.id,
        name: 'Test Widget',
        productDetails: 'A widget that does widget things.',
        profile: { productSummary: 'Does widget things well.', differentiators: 'Cheaper.' },
        brandVoice: 'Casual',
        language: 'en',
      },
    });

    const profile = await getProfile(ownerA.id);
    check('getProfile returns ownerId', profile.ownerId === ownerA.id, profile.ownerId);
    check('getProfile carries user defaultLanguage', profile.defaultLanguage === 'en', profile.defaultLanguage);
    check('getProfile carries user brandVoice', profile.brandVoice === 'Bold and playful', profile.brandVoice);
    check('getProfile.products is well-formed array incl. seeded entry', profile.products.some((p) => p.id === pk.id), profile.products);

    const one = await getProduct(ownerA.id, pk.id);
    check('getProduct finds owned entry', one?.id === pk.id, one);
    check('getProduct maps summary', one?.summary === 'Does widget things well.', one?.summary);

    const cross = await getProduct(ownerB.id, pk.id);
    check('getProduct cross-tenant read -> null (isolation)', cross === null, cross);

    const updated = await remember(ownerA.id, pk.id, { targetAudience: 'Weekend tinkerers', brandVoice: 'Warm' });
    check('remember updates targeted field', updated?.targetAudience === 'Weekend tinkerers', updated?.targetAudience);
    check('remember updates brandVoice column', updated?.brandVoice === 'Warm', updated?.brandVoice);
    check('remember preserves untouched summary (merge, not overwrite)', updated?.summary === 'Does widget things well.', updated?.summary);
    check('remember preserves untouched differentiators', updated?.differentiators === 'Cheaper.', updated?.differentiators);

    const rememberCross = await remember(ownerB.id, pk.id, { targetAudience: 'hijacked' });
    check('remember cross-tenant write -> null (isolation)', rememberCross === null, rememberCross);

    const untouched = await getProduct(ownerA.id, pk.id);
    check('cross-tenant remember attempt did not mutate the row', untouched?.targetAudience === 'Weekend tinkerers', untouched?.targetAudience);

    const missing = await getProfile('00000000-0000-0000-0000-000000000000');
    check('unknown owner -> empty profile, no throw', missing.products.length === 0 && missing.defaultLanguage === null, missing);
  } finally {
    await prisma.productKnowledge.deleteMany({ where: { ownerId: { in: [ownerA.id, ownerB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id] } } });
    console.log('cleanup: 2 throwaway tenants removed');
  }
}

async function main(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.log(`\nSKIP DB checks — Postgres unreachable (${String(e instanceof Error ? e.message : e).slice(0, 120)})`);
    console.log(failures === 0 ? '\nPASS — memory facade pure checks green (DB skipped)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
    return;
  }

  await dbChecks();
  console.log(failures === 0 ? '\nPASS — memory facade checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
