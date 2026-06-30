// External-action audit verification. Pure part: redactDetail drops any non-whitelist
// key (incl. token/secret) and non-scalar values. Live part (needs DB on :5433): a
// recordExternalAction round-trips, the row carries the outcome, and NO secret field
// is persisted. Run with DB up: `npx tsx src/connectors/audit/verify-audit.ts`.
import 'dotenv/config';
import { prisma } from '../../db/client.ts';
import { redactDetail, recordExternalAction } from './external-action-audit-log.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const run = async () => {
  // ---- Pure: redaction ----
  const dirty = {
    postId: 'p1',
    assetType: 'image',
    token: 'SECRET-TOKEN',
    access_token: 'SECRET',
    authorization: 'Bearer x',
    refresh_token: 'r',
    nested: { secret: 'no' },
  };
  const clean = redactDetail(dirty) ?? {};
  check('redact keeps postId', clean.postId === 'p1', clean);
  check('redact keeps assetType', clean.assetType === 'image', clean);
  check('redact drops token', !('token' in clean), clean);
  check('redact drops access_token', !('access_token' in clean), clean);
  check('redact drops authorization', !('authorization' in clean), clean);
  check('redact drops refresh_token', !('refresh_token' in clean), clean);
  check('redact drops nested object', !('nested' in clean), clean);
  check('redact drops undefined-valued key', !('idempotencyKey' in (redactDetail({ postId: 'p', idempotencyKey: undefined }) ?? {})), redactDetail({ postId: 'p', idempotencyKey: undefined }));
  check('redact null → null', redactDetail(null) === null);
  // Exact whitelist guard: a token alongside a safe key yields ONLY the safe key. This
  // is the highest-stakes invariant — pins SAFE_DETAIL_KEYS against a careless future edit.
  check('redact({access_token,postId}) deep-equals {postId}', JSON.stringify(redactDetail({ access_token: 'x', postId: 'p' })) === JSON.stringify({ postId: 'p' }), redactDetail({ access_token: 'x', postId: 'p' }));

  // ---- Live: write + read back ----
  const owner = await prisma.user.create({ data: { email: `audit-${Date.now()}@test.local` } });
  try {
    await recordExternalAction({
      ownerId: owner.id,
      platform: 'facebook',
      actionKey: 'social.post.image',
      status: 'ok',
      externalId: 'https://fb.test/post/123',
      detail: { postId: 'p1', assetType: 'image', token: 'SHOULD-NOT-PERSIST' } as any,
    });
    const rows = await prisma.externalActionAuditLog.findMany({ where: { ownerId: owner.id } });
    check('audit row written', rows.length === 1, rows.length);
    const r = rows[0]!;
    check('row carries platform + actionKey', r.platform === 'facebook' && r.actionKey === 'social.post.image', r);
    check('row carries status ok + externalId', r.status === 'ok' && r.externalId === 'https://fb.test/post/123', r);
    const detailStr = JSON.stringify(r.detail);
    check('persisted detail has NO token', !/SHOULD-NOT-PERSIST|token/.test(detailStr), detailStr);
    check('persisted detail kept postId', /p1/.test(detailStr), detailStr);
  } finally {
    await prisma.externalActionAuditLog.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    console.log('cleanup: audit tenant + rows removed');
  }

  console.log(failures === 0 ? '\nPASS — all audit checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
