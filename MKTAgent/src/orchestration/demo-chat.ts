// Live demo (throwaway) — shows what the Master Agent returns for real chat
// messages on BOTH surfaces: the OLD /agent intake (what the UI calls today) and
// the NEW /orchestration M1 backbone. Prints assistant text, clarification
// questions and the planned DAG. Cleans up. Run with the server up on :7100.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';

const BASE = `http://localhost:${env.PORT}`;
const call = async (method: string, path: string, token: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
};

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(78));

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `demo-${Date.now()}@test.local`, displayName: 'Demo', defaultLanguage: 'vi' } });
  const token = signSession({ sub: user.id, email: user.email });

  const messages = [
    'Tôi muốn làm marketing',                                            // vague
    'Tôi muốn đăng bài giới thiệu khóa học AI automation lên Facebook và LinkedIn', // text + 2 platforms
    'Tôi muốn post + infographic + video ngắn cho sản phẩm cà phê trên Instagram', // full media pipeline
  ];

  try {
    for (const msg of messages) {
      hr();
      line(`USER: ${msg}`);
      hr();

      // ---- OLD surface: /agent intake (what the web chat calls today) ----
      const intake = await call('POST', '/agent/intake', token, { message: msg, timezone: 'Asia/Bangkok' });
      const d = intake.body?.data;
      line('\n[A] OLD /agent intake (current UI chat):');
      line(`    assistantMessage: ${d?.assistantMessage ?? '(none)'}`);
      line(`    template (fixed): ${d?.selectedTemplateTitle} | confidence ${d?.confidence}`);
      line(`    missingFields:    ${(d?.missingFields ?? []).map((m: any) => m.label).join(', ') || '(none)'}`);

      // ---- NEW surface: /orchestration M1 Master Agent ----
      const run = await call('POST', '/orchestration/runs', token, { message: msg });
      const r = run.body?.data;
      line(`\n[B] NEW /orchestration M1 Master Agent → status: ${r?.status}`);
      if (r?.status === 'awaiting_clarification') {
        line('    clarification questions:');
        for (const q of r.questions ?? []) {
          const choices = q.choices ? `  [${q.choices.join(' | ')}]` : '';
          line(`      • (${q.required ? 'required' : 'optional'}) ${q.question}${choices}`);
        }
      } else if (r?.status === 'planned') {
        line('    planned DAG:');
        for (const n of r.nodes ?? []) {
          const dep = n.dependsOn.length ? ` ← depends on ${n.dependsOn.join(',')}` : '';
          line(`      ${n.nodeId}: ${n.agentId}${dep}`);
        }
      }
      line('');
    }
    hr();
    line('NOTE: surface [A] is what the UI chat shows today; [B] is the new M1 backbone (not yet wired to the UI).');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    line('cleanup: demo tenant removed');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
