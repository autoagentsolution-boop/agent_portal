// One-off backfill (§01.2) — encrypt any legacy plaintext lead PII and set email_bidx.
// Idempotent: skips rows already encrypted (isEncrypted). Run once after the migration.
import { prisma } from '../db/client.ts';
import { encryptToken, blindIndex, isEncrypted } from '../lib/crypto.ts';

async function main() {
  const rows = await prisma.lead.findMany();
  let done = 0, skipped = 0;
  for (const l of rows) {
    // Phase 03: email is now nullable (handle-only comment leads have none) — nothing to backfill.
    const email = l.email;
    if (!email) { skipped++; continue; }
    if (isEncrypted(email) && l.emailBidx) { skipped++; continue; }
    const plainEmail = isEncrypted(email) ? null : email; // already-encrypted email → keep, just ensure bidx below
    await prisma.lead.update({
      where: { id: l.id },
      data: {
        ...(isEncrypted(email) ? {} : { email: encryptToken(email) }),
        emailBidx: l.emailBidx ?? blindIndex(plainEmail ?? email),
        ...(l.name && !isEncrypted(l.name) ? { name: encryptToken(l.name) } : {}),
        ...(l.phone && !isEncrypted(l.phone) ? { phone: encryptToken(l.phone) } : {}),
        ...(l.message && !isEncrypted(l.message) ? { message: encryptToken(l.message) } : {}),
        rawPayload: undefined, // leave existing raw as-is; not re-writing (scrub is a separate op)
      },
    });
    done++;
  }
  console.log(`backfill done: ${done} encrypted, ${skipped} already-encrypted`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
