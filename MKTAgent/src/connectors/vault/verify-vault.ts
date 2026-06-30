// Credential Vault verification — exercises the encrypted-DB vault directly (no DB):
// seal→open round-trips, the sealed string is NOT the plaintext (real encryption),
// each seal is unique (random IV), and a tampered/garbage value fails loud on open.
// Asserts the LLM-exposure invariant at the layer boundary: a sealed secret reveals
// nothing about the plaintext. Run: TOKEN_ENC_KEY set, `npx tsx src/connectors/vault/verify-vault.ts`.
import 'dotenv/config';
import { encryptedDbVault as vault } from './encrypted-db-vault.ts';
import { secretRefFor } from './credential-vault.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const run = async () => {
  const secret = 'EAAB-super-secret-oauth-token-1234567890';

  // 1) Round-trip.
  const sealed = await vault.seal(secret);
  const opened = await vault.open(sealed);
  check('seal→open round-trips', opened === secret, { opened });

  // 2) Sealed string is real ciphertext — not the plaintext, and doesn't contain it.
  check('sealed != plaintext', sealed !== secret, sealed.slice(0, 16));
  check('sealed does not embed plaintext', !sealed.includes(secret), sealed.slice(0, 16));
  check('sealed uses versioned scheme (v1.)', sealed.startsWith('v1.'), sealed.slice(0, 8));

  // 3) Unique per seal (random IV) — same plaintext, different ciphertext.
  const sealed2 = await vault.seal(secret);
  check('each seal is unique (random IV)', sealed !== sealed2, { a: sealed.slice(0, 20), b: sealed2.slice(0, 20) });
  check('both still open to the same plaintext', (await vault.open(sealed2)) === secret);

  // 4) Tamper detection — flip a ciphertext byte → open must throw (GCM auth tag).
  const parts = sealed.split('.');
  const ct = Buffer.from(parts[3]!, 'base64');
  ct[0] = ct[0]! ^ 0xff;
  const tampered = [parts[0], parts[1], parts[2], ct.toString('base64')].join('.');
  let threw = false;
  try { await vault.open(tampered); } catch { threw = true; }
  check('tampered ciphertext → open throws', threw);

  // 5) Garbage input → throws (malformed, not silently empty).
  let threw2 = false;
  try { await vault.open('not-a-valid-sealed-value'); } catch { threw2 = true; }
  check('garbage → open throws', threw2);

  // 6) secretRef naming is stable + tenant/platform scoped (for a future ext vault).
  check('secretRef shape', secretRefFor('owner-1', 'facebook') === 'vault://oauth/owner-1/facebook', secretRefFor('owner-1', 'facebook'));

  console.log(failures === 0 ? '\nPASS — all vault checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

void run();
