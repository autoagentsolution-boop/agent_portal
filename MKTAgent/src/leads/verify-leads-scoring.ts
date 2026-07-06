// Verify §01.5 — hybrid lead scoring. Rule layer is pure/deterministic; capture stamps a
// score + reasons; the rescore route applies the LLM layer (best-effort → always 200).
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { ruleScore } from './scoring/rule-score.ts';
import { applyLlmAdjustment, llmScoreAdjustment } from './scoring/llm-score.ts';

const BASE = `http://localhost:${env.PORT}`;
let fail = 0;
const ck = (n: string, c: boolean, x?: unknown) => { console.log(c ? `  ok   ${n}` : `  FAIL ${n} ${JSON.stringify(x)?.slice(0, 200)}`); if (!c) fail++; };
const call = async (m: string, p: string, opts: { token?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
  const res = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) }, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
};

async function main() {
  // --- Pure rule layer ---
  const calcom = ruleScore({ source: 'calcom', hasPhone: true, message: 'I want to buy 50 licenses for my team next quarter' });
  const webhook = ruleScore({ source: 'webhook', hasPhone: false, message: null });
  ck('calcom+phone+detailed > webhook bare', calcom.score > webhook.score, { calcom: calcom.score, webhook: webhook.score });
  ck('scores clamp 0-100', calcom.score <= 100 && webhook.score >= 0, { calcom: calcom.score, webhook: webhook.score });
  ck('rule reasons are auditable', calcom.reasons.every((r) => r.layer === 'rule' && typeof r.reason === 'string'), calcom.reasons);
  ck('phone adds points', ruleScore({ source: 'form', hasPhone: true, message: null }).score > ruleScore({ source: 'form', hasPhone: false, message: null }).score);

  // --- LLM layer with an INJECTED fake (DRY, no real Gemini) ---
  const adj = await llmScoreAdjustment({ ruleScore: 50, email: 'x@y.z', message: 'ready to buy now', source: 'form' }, async () => ({ delta: 25, reason: 'explicit purchase intent' }));
  ck('llm layer returns a clamped adjustment', adj?.layer === 'llm' && adj.delta === 25, adj);
  ck('applyLlmAdjustment clamps to 100', applyLlmAdjustment(90, adj) === 100, applyLlmAdjustment(90, adj));
  ck('llm null → base unchanged', applyLlmAdjustment(50, null) === 50);

  // --- HTTP: capture stamps a score; rescore route responds 200 ---
  const u = await prisma.user.create({ data: { email: `score-${Date.now()}@t.local` } });
  const jwt = signSession({ sub: u.id, email: u.email });
  try {
    const tok = (await call('POST', '/leads/intake-tokens', { token: jwt })).body?.data?.token as string;
    await call('POST', '/leads/webhook', { headers: { 'x-intake-token': tok }, body: { email: `s-${Date.now()}@lead.local`, phone: '+84900', message: 'interested in a demo for my company' } });
    const list = await call('GET', '/leads', { token: jwt });
    const lead = list.body?.data?.[0];
    ck('captured lead has a score', typeof lead?.score === 'number' && lead.score > 0, lead?.score);
    ck('captured lead has reasons', Array.isArray(lead?.scoreReasons) && lead.scoreReasons.length > 0, lead?.scoreReasons?.length);
    const re = await call('POST', `/leads/${lead.id}/rescore`, { token: jwt });
    ck('rescore → 200 with a score (LLM best-effort)', re.status === 200 && typeof re.body?.data?.score === 'number', { s: re.status, sc: re.body?.data?.score });
    ck('rescore cross-tenant/unknown → 404', (await call('POST', `/leads/00000000-0000-0000-0000-000000000000/rescore`, { token: jwt })).status === 404);
  } finally {
    await prisma.lead.deleteMany({ where: { ownerId: u.id } });
    await prisma.leadIntakeToken.deleteMany({ where: { ownerId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
    await prisma.$disconnect();
  }
  console.log(fail ? `\nFAIL — ${fail}` : '\nPASS — hybrid lead scoring works');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
