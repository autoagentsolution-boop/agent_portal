// Focused smoke (item 5) — a post created under a campaign inherits the campaign's
// platforms/language when the brief omits them, and an explicit body value still wins.
// Live HTTP against :7100. No Gemini (POST /posts is deterministic). Self-cleans.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const call = async (method: string, path: string, token: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body: json };
};

async function main(): Promise<void> {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`Server not reachable at ${BASE} — start it first. ${String(e)}`);
    process.exit(2);
  }

  const user = await prisma.user.create({ data: { email: `post-inherit-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const token = signSession({ sub: user.id, email: user.email });

  try {
    // Campaign with FB+IG + language, NO flow (legacy path → runId null).
    const campaign = await prisma.campaign.create({
      data: { ownerId: user.id, product: 'Inherit Test Product', platforms: ['facebook', 'instagram'], language: 'vi' },
    });

    // 1. Brief omits platforms/language → inherits from campaign.
    const inherited = await call('POST', '/posts', token, { campaignId: campaign.id });
    check('201 created (inherit)', inherited.status === 201, inherited);
    const p1 = inherited.body?.data;
    check('inherits campaign platforms (FB+IG)',
      Array.isArray(p1?.platforms) && p1.platforms.includes('facebook') && p1.platforms.includes('instagram'),
      p1?.platforms);
    check('inherits campaign language (vi)', p1?.language === 'vi', p1?.language);

    // 2. Explicit body value wins over campaign.
    const override = await call('POST', '/posts', token, { campaignId: campaign.id, platforms: ['facebook'], language: 'en' });
    const p2 = override.body?.data;
    check('explicit platforms win (FB only)',
      Array.isArray(p2?.platforms) && p2.platforms.length === 1 && p2.platforms[0] === 'facebook', p2?.platforms);
    check('explicit language wins (en)', p2?.language === 'en', p2?.language);

    console.log(failures === 0 ? '\nPASS — post platform/language inheritance green' : `\nFAIL — ${failures} check(s)`);
  } finally {
    await prisma.post.deleteMany({ where: { ownerId: user.id } });
    await prisma.campaign.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
