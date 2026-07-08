// Atria v2 P5 #1 verification — the chained-rerun race guard. The /rerun-node route now claims the
// run atomically (transitionRun guarded on the exact read status) BEFORE resetting nodes, so two
// concurrent reruns (or a rerun racing a resume/approve) can't both launch a detached executor and
// corrupt node state. Proves: exactly ONE of two concurrent claims from the same status wins; a claim
// from a stale/wrong status loses; a claim never fires from an already-running run. Throwaway tenant.
import { prisma } from '../db/client.ts';
import { transitionRun } from '../db/repos/workflow-run-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `rerun-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const other = await prisma.user.create({ data: { email: `rerun-other-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const mk = (status: string) => prisma.workflowRun.create({ data: { ownerId: user.id, goal: {}, status } });

    // ── Two concurrent claims from `needs_approval` → exactly one wins ───────────────────────────
    const r1 = await mk('needs_approval');
    const [a, b] = await Promise.all([
      transitionRun(r1.id, user.id, 'needs_approval', 'running'),
      transitionRun(r1.id, user.id, 'needs_approval', 'running'),
    ]);
    const winners = [a, b].filter(Boolean).length;
    check('race: exactly one of two concurrent claims wins', winners === 1, { winners });
    check('race: run ends up running', (await prisma.workflowRun.findUnique({ where: { id: r1.id } }))?.status === 'running');

    // ── Same, from `planned` (the post-rerun resumable state) ────────────────────────────────────
    const r2 = await mk('planned');
    const [c, d] = await Promise.all([
      transitionRun(r2.id, user.id, 'planned', 'running'),
      transitionRun(r2.id, user.id, 'planned', 'running'),
    ]);
    check('race: one wins from planned too', [c, d].filter(Boolean).length === 1, { c: !!c, d: !!d });

    // ── Claim from a STALE status (run already moved on) loses ───────────────────────────────────
    const r3 = await mk('running'); // already running (e.g. another executor claimed it)
    const stale = await transitionRun(r3.id, user.id, 'needs_approval', 'running'); // reader thought it was needs_approval
    check('stale: claim from wrong `from` status → null (no double launch)', stale === null, stale);

    // ── Tenant isolation: cross-tenant claim never wins ──────────────────────────────────────────
    const r4 = await mk('planned');
    check('isolation: cross-tenant claim → null', (await transitionRun(r4.id, other.id, 'planned', 'running')) === null);
    check('isolation: run untouched by cross-tenant attempt', (await prisma.workflowRun.findUnique({ where: { id: r4.id } }))?.status === 'planned');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: other.id } });
    console.log('cleanup: throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — rerun race guard green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
