// Verify P4 (Instructions ground Atria) + P5a (Memory smarter) — the DETERMINISTIC seams, no Gemini:
//   1. resolveWorkspaceInstructionsBlock: a workspace instruction → labeled block; none → null.
//   2. captureFromGoal: a goal with product+angle persists an angle fact (product-keyed).
//   3. recallForMessage ranking: among equal-relevance facts, the more-used one ranks first (usedCount).
//   4. GET/DELETE /memory/facts: the slot-fact list surfaces + prunes (HTTP, live :7100).
// The LLM-dependent "instruction reflected in the proposed angle" is validated in P6 (browser). Self-cleans.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { resolveWorkspaceInstructionsBlock } from './prompts/resolve-instructions.ts';
import { captureFromGoal, recallForMessage } from '../memory/user-memory.ts';
import { createInstruction } from '../db/repos/instruction-repo.ts';
import { rememberKeyed, markUsed, listMemories } from '../db/repos/user-memory-repo.ts';
import { goalSpec } from './schemas/goal-spec.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const call = async (method: string, path: string, token: string) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
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

  const user = await prisma.user.create({ data: { email: `imem-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const token = signSession({ sub: user.id, email: user.email });

  try {
    // 1. Instructions block — none yet → null.
    const none = await resolveWorkspaceInstructionsBlock(user.id);
    check('no instructions → null block', none === null, none);
    // Add a workspace, all-agent instruction → block includes it, labeled.
    await createInstruction({ ownerId: user.id, scope: 'workspace', agentId: null, content: 'Always use a witty tone and target SME founders.' });
    const block = await resolveWorkspaceInstructionsBlock(user.id);
    check('instruction → labeled block', Boolean(block?.includes('USER INSTRUCTIONS') && block.includes('witty tone')), block);

    // 2. Angle capture — a goal with product + angle persists an angle fact.
    const base = analyzeDeterministic('make a post about Widget');
    const goal = goalSpec.parse({ ...base, slots: { ...base.slots, product: 'Widget', angle: 'save an hour a day' } });
    await captureFromGoal(user.id, goal, null);
    const facts = await listMemories(user.id);
    check('angle captured (product-keyed)', facts.some((m) => m.key === 'angle:widget' && m.content.includes('save an hour')), facts.map((m) => m.key));
    check('language NOT captured (guard)', !facts.some((m) => m.key === 'language'), facts.map((m) => m.key));

    // 3. Ranking — two equally-relevant facts about "gadget", the more-used one ranks first.
    await rememberKeyed(user.id, 'fact', 'gadget-a', 'gadget note A: low use', null);
    await rememberKeyed(user.id, 'fact', 'gadget-b', 'gadget note B: high use', null);
    const bId = (await listMemories(user.id)).find((m) => m.key === 'gadget-b')!.id;
    for (let i = 0; i < 5; i++) await markUsed(user.id, [bId]); // bump usedCount on B
    const recall = await recallForMessage(user.id, 'tell me about the gadget');
    const ctx = recall.context ?? '';
    const idxA = ctx.indexOf('gadget note A');
    const idxB = ctx.indexOf('gadget note B');
    check('both gadget facts recalled', idxA >= 0 && idxB >= 0, { idxA, idxB });
    check('more-used fact ranks first (usedCount)', idxB >= 0 && (idxA < 0 || idxB < idxA), { idxA, idxB });

    // 4. HTTP — /memory/facts lists the slot facts and deletes one.
    const list = await call('GET', '/memory/facts', token);
    check('GET /memory/facts 200', list.status === 200, list.status);
    check('facts list non-empty + shaped', Array.isArray(list.body?.data) && list.body.data.length > 0 && typeof list.body.data[0].kind === 'string', list.body?.data?.[0]);
    const target = list.body.data.find((f: any) => f.key === 'angle:widget');
    const del = await call('DELETE', `/memory/facts/${target.id}`, token);
    check('DELETE /memory/facts/:id 204', del.status === 204, del.status);
    const after = await call('GET', '/memory/facts', token);
    check('deleted fact gone', !after.body.data.some((f: any) => f.id === target.id), after.body?.data?.map((f: any) => f.key));
    // Well-formed but nonexistent id → clean 404 (owner-scoped miss), not a match.
    const foreign = await call('DELETE', `/memory/facts/00000000-0000-0000-0000-000000000000`, token);
    check('unknown fact → 404', foreign.status === 404, foreign.status);
  } finally {
    // Cascade: instructions + memories are owner-scoped; delete the user's rows then the user.
    await prisma.userMemory.deleteMany({ where: { ownerId: user.id } }).catch(() => {});
    await prisma.instruction.deleteMany({ where: { ownerId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

void main();
