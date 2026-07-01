// P6 live-HTTP e2e — drives the REAL router path the Orchestrate UI hits (:7100), not
// the DB helper. Proves: POST /runs plans a flow on a chat session → POST /runs/:id/save
// names it AND returns the Master Agent's guiding offer as assistantMessage → the offer
// is persisted as an agent turn on the chat (survives restore) → POST /campaigns with
// flowId links a campaign to the flow ("set up first campaign") → GET /orchestration/runs/saved
// lists it. DRY: no execute, no publish, no image spend. Throwaway tenant, cleaned up.
// Run: server up on :7100, then `npx tsx src/orchestration/verify-save-offer-http.ts`.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function main(): Promise<void> {
  try { const h = await fetch(`${BASE}/health`); if (!h.ok) throw new Error(`health ${h.status}`); }
  catch (e) { console.error(`Server not reachable at ${BASE}. ${String(e)}`); process.exit(2); }

  const user = await prisma.user.create({ data: { email: `soh-${Date.now()}@test.local` } });
  const token = signSession({ sub: user.id, email: user.email });

  try {
    // Plan a flow via the real endpoint. A full branding message → a multi-step planned DAG.
    const created = await call('POST', '/orchestration/runs', token, {
      message: 'Full branding campaign about our AI automation course for founders, publish to facebook and instagram',
    });
    check('POST /runs → 201', created.status === 201, created.status);
    const run = created.body?.data as { id: string; status: string; chatSessionId: string; nodes: unknown[] };
    check('run planned with nodes', run?.status === 'planned' && run.nodes.length > 0, { status: run?.status, nodes: run?.nodes?.length });
    check('run has a chat session', Boolean(run?.chatSessionId), run?.chatSessionId);

    // Save (name) it — the P6 offer must ride back on assistantMessage.
    const saved = await call('POST', `/orchestration/runs/${run.id}/save`, token, { name: 'AI Course flow' });
    check('POST /save → 200', saved.status === 200, saved.status);
    const savedRun = saved.body?.data as { name: string; assistantMessage?: string };
    check('save named the flow', savedRun?.name === 'AI Course flow', savedRun?.name);
    check('save returns an offer (assistantMessage)', Boolean(savedRun?.assistantMessage?.trim()), savedRun?.assistantMessage);
    check('offer makes no publish claim', !/published|đã đăng/i.test(savedRun?.assistantMessage ?? ''), savedRun?.assistantMessage);

    // Offer persisted on the chat → history restore shows it. Last message is the agent offer.
    const chat = await call('GET', `/agent/chats/${run.chatSessionId}`, token);
    const msgs = (chat.body?.data as { messages: Array<{ role: string; content: string }> })?.messages ?? [];
    const last = msgs[msgs.length - 1];
    check('offer persisted as last agent turn', last?.role === 'agent' && last.content === savedRun.assistantMessage, last?.role);

    // Idempotency: saving an already-named (no longer planned) run must NOT double-post.
    const before = msgs.length;
    const resave = await call('POST', `/orchestration/runs/${run.id}/save`, token, { name: 'AI Course flow' });
    check('re-save of named run → 409 (not planned)', resave.status === 409, resave.status);
    const chat2 = await call('GET', `/agent/chats/${run.chatSessionId}`, token);
    const after = ((chat2.body?.data as { messages: unknown[] })?.messages ?? []).length;
    check('no duplicate offer turn on re-save', after === before, { before, after });

    // "Set up first campaign" — create a campaign linked to the flow (Campaign.flowId = runId).
    const camp = await call('POST', '/campaigns', token, { product: 'AI Course flow', flowId: run.id });
    check('POST /campaigns with flowId → 201', camp.status === 201, camp.status);
    const campaign = camp.body?.data as { id: string; flowId: string | null };
    check('campaign linked to flow', campaign?.flowId === run.id, campaign?.flowId);

    // Saved-flows list shows the named run (sidebar source).
    const savedList = await call('GET', '/orchestration/runs/saved', token);
    const rows = (savedList.body?.data as Array<{ id: string; name: string }>) ?? [];
    check('flow appears in /runs/saved', rows.some((r) => r.id === run.id && r.name === 'AI Course flow'), rows.map((r) => r.name));
  } finally {
    // Cascade: deleting the tenant removes runs, chats, campaigns.
    await prisma.user.delete({ where: { id: user.id } }).catch((e) => console.error('cleanup', String(e)));
    console.log('cleanup: throwaway tenant removed');
  }
  console.log(failures === 0 ? '\nverify-save-offer-http: ALL GREEN' : `\nverify-save-offer-http: ${failures} FAILURE(S)`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
