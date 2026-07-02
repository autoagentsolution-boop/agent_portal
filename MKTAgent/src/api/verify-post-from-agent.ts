// Focused smoke (item 3) — POST /posts/from-agent: the Master Agent extracts the brief
// from a free-text description so the user never hand-fills the form. Live HTTP against
// :7100, live Gemini (the requirement analyzer). Self-cleans its throwaway tenant.
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

  const user = await prisma.user.create({ data: { email: `post-agent-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const token = signSession({ sub: user.id, email: user.email });
  const other = await prisma.user.create({ data: { email: `post-agent-other-${Date.now()}@test.local`, defaultLanguage: 'en' } });

  try {
    // Campaign with a fallback platform + language (agent output should override when it
    // extracts platforms/language; otherwise these inherit through buildPostUnderCampaign).
    const campaign = await prisma.campaign.create({
      data: { ownerId: user.id, product: 'AI Automation Course', platforms: ['facebook'], language: 'en' },
    });

    // 1. Image, Vietnamese, Instagram — agent should fill language + platforms + asset=image.
    const r1 = await call('POST', '/posts/from-agent', token, {
      campaignId: campaign.id,
      message: 'Short punchy Vietnamese Instagram post about our AI automation course, upbeat brand voice',
    });
    check('201 created (image/vi/ig)', r1.status === 201, r1);
    const p1 = r1.body?.data;
    check('status brief', p1?.status === 'brief', p1?.status);
    check('assetType image', p1?.assetType === 'image', p1?.assetType);
    check('language vi', p1?.language === 'vi', p1?.language);
    check('platforms include instagram', Array.isArray(p1?.platforms) && p1.platforms.includes('instagram'), p1?.platforms);
    check('filled reported', Array.isArray(p1?.filled) && p1.filled.includes('asset type'), p1?.filled);

    // 2. Message asking for a video → assetType video.
    const r2 = await call('POST', '/posts/from-agent', token, {
      campaignId: campaign.id,
      message: 'Make a short promotional video for Facebook about the AI automation course',
    });
    const p2 = r2.body?.data;
    check('201 created (video)', r2.status === 201, r2);
    check('assetType video', p2?.assetType === 'video', p2?.assetType);

    // 3. Foreign campaign → 404 (tenancy).
    const foreign = await prisma.campaign.create({ data: { ownerId: other.id, product: 'Foreign', platforms: ['facebook'] } });
    const r3 = await call('POST', '/posts/from-agent', token, { campaignId: foreign.id, message: 'anything about a product' });
    check('404 foreign campaign', r3.status === 404, r3);

    // 4. Too-short message → 422 (schema guard).
    const r4 = await call('POST', '/posts/from-agent', token, { campaignId: campaign.id, message: 'x' });
    check('422 short message', r4.status === 422, r4.status);

    console.log(failures === 0 ? '\nPASS — post from-agent green' : `\nFAIL — ${failures} check(s)`);
  } finally {
    await prisma.post.deleteMany({ where: { ownerId: user.id } });
    await prisma.workflowRun.deleteMany({ where: { ownerId: user.id } });
    await prisma.campaign.deleteMany({ where: { ownerId: user.id } });
    await prisma.campaign.deleteMany({ where: { ownerId: other.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: other.id } });
    console.log('cleanup: throwaway tenants removed');
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
