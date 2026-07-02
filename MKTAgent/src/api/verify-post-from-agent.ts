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
    // Campaign WITH an angle + platforms → the agent has enough context, so a descriptive
    // message creates immediately (no clarify). Response shape: { post, filled }.
    const campaign = await prisma.campaign.create({
      data: { ownerId: user.id, product: 'AI Automation Course', angle: 'Learn AI fast', platforms: ['facebook'], language: 'en' },
    });

    // 1. Image, Vietnamese, Instagram — creates directly (campaign supplies angle).
    const r1 = await call('POST', '/posts/from-agent', token, {
      campaignId: campaign.id,
      message: 'Short punchy Vietnamese Instagram post about our AI automation course, upbeat brand voice',
    });
    check('201 created (no clarify — campaign has angle)', r1.status === 201, r1);
    const p1 = r1.body?.data?.post;
    check('status brief', p1?.status === 'brief', p1?.status);
    check('assetType image', p1?.assetType === 'image', p1?.assetType);
    check('language vi', p1?.language === 'vi', p1?.language);
    check('platforms include instagram', Array.isArray(p1?.platforms) && p1.platforms.includes('instagram'), p1?.platforms);
    check('filled reported', Array.isArray(r1.body?.data?.filled) && r1.body.data.filled.includes('asset type'), r1.body?.data?.filled);

    // 2. Message asking for a video → assetType video (campaign angle covers the gate).
    const r2 = await call('POST', '/posts/from-agent', token, {
      campaignId: campaign.id,
      message: 'Make a short promotional video for Facebook about the AI automation course',
    });
    const p2 = r2.body?.data?.post;
    check('201 created (video)', r2.status === 201, r2);
    check('assetType video', p2?.assetType === 'video', p2?.assetType);

    // 3. CLARIFY — a BARE campaign (no angle, no platforms) + a thin message → the agent
    // asks for angle + platforms before creating (200 with questions, NO post).
    const bare = await prisma.campaign.create({ data: { ownerId: user.id, product: 'Mystery', platforms: [] } });
    const c1 = await call('POST', '/posts/from-agent', token, { campaignId: bare.id, message: 'make a post please' });
    check('200 clarify (no angle/platforms)', c1.status === 200, c1.status);
    const qs = c1.body?.data?.questions;
    check('questions returned', Array.isArray(qs) && qs.length > 0, qs);
    check('asks angle (required)', Array.isArray(qs) && qs.some((q: any) => q.slot === 'angle' && q.required), qs);
    check('asks platforms (required)', Array.isArray(qs) && qs.some((q: any) => q.slot === 'platforms' && q.required), qs);
    check('no post created on clarify', !c1.body?.data?.post, c1.body?.data?.post);

    // 4. Answer the clarify → post is created with the answered angle + platforms.
    const c2 = await call('POST', '/posts/from-agent', token, {
      campaignId: bare.id,
      message: 'make a post please',
      answers: { angle: 'Big launch discount', platforms: ['facebook', 'linkedin'], assetType: 'image' },
    });
    check('201 created after answers', c2.status === 201, c2.status);
    const p4 = c2.body?.data?.post;
    check('answered angle applied', p4?.angle === 'Big launch discount', p4?.angle);
    check('answered platforms applied (fb+li)', Array.isArray(p4?.platforms) && p4.platforms.includes('facebook') && p4.platforms.includes('linkedin'), p4?.platforms);

    // 5. Foreign campaign → 404 (tenancy).
    const foreign = await prisma.campaign.create({ data: { ownerId: other.id, product: 'Foreign', angle: 'x', platforms: ['facebook'] } });
    const r3 = await call('POST', '/posts/from-agent', token, { campaignId: foreign.id, message: 'anything about a product' });
    check('404 foreign campaign', r3.status === 404, r3);

    // 6. Too-short message → 422 (schema guard).
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
