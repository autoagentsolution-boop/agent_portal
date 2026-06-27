// Opaque server-side session store (T8 — browser BFF). The browser receives only
// a random handle in an HttpOnly cookie; the JWT/credential never leaves the
// server. At rest we keep the SHA-256 of the handle, so a DB read cannot mint a
// live cookie. Sessions are server-revocable (delete the row) — strictly stronger
// than a stateless JWT-in-cookie, which can't be invalidated before its exp.
//
// Bearer JWT remains the path for CLI/tests/service-to-service; this is additive.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db/client.ts';
import { env } from '../config/env.ts';

export const SESSION_COOKIE = 'mkt_session';

// ms TTL parsed from env (e.g. "30d", "12h"). Kept tiny — no date lib.
const parseTtlMs = (ttl: string): number => {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 30 * 86_400_000; // default 30d
  const n = Number(m[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]!]!;
  return n * unit;
};

export const sessionTtlMs = (): number => parseTtlMs(env.SESSION_TTL);

const hash = (handle: string): string => createHash('sha256').update(handle).digest('hex');

export interface NewSession {
  handle: string; // goes in the cookie (only time it exists in cleartext)
  expiresAt: Date;
}

// Mint a session for a user. Returns the cleartext handle for the Set-Cookie; only
// its hash is persisted. 32 random bytes = 256 bits of entropy (unguessable).
export const createSession = async (ownerId: string, userAgent?: string): Promise<NewSession> => {
  const handle = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await prisma.session.create({
    data: { ownerId, tokenHash: hash(handle), userAgent: userAgent?.slice(0, 300) ?? null, expiresAt },
  });
  return { handle, expiresAt };
};

// Resolve a cookie handle → ownerId, or null (absent/expired/revoked). Expired
// rows are pruned opportunistically. Constant-time compare on the looked-up hash.
export const resolveSession = async (handle: string | undefined): Promise<string | null> => {
  if (!handle) return null;
  const h = hash(handle);
  const row = await prisma.session.findUnique({ where: { tokenHash: h } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  // findUnique already matched on hash; this guards against any non-constant-time
  // path leaking through and keeps the comparison explicit.
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(h);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row.ownerId;
};

// Revoke one session by its cookie handle (logout). Idempotent.
export const revokeSession = async (handle: string | undefined): Promise<void> => {
  if (!handle) return;
  await prisma.session.deleteMany({ where: { tokenHash: hash(handle) } });
};
