// Phase 3 verification — DB round-trip of WorkflowRun/NodeRun/Artifact + tenant
// isolation + artifact schema validation at the store boundary. Creates two
// throwaway tenants, exercises the repo + artifact-store, then cleans up. Requires
// Postgres up (docker compose up -d postgres). Uses prisma import, not psql.
import { prisma } from '../db/client.ts';
import { createRun, createNodes, getRunWithNodes, getRunForOwner, transitionRun } from '../db/repos/workflow-run-repo.ts';
import { putArtifact, listArtifacts, ArtifactValidationError } from './executor/artifact-store.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main(): Promise<void> {
  const userA = await prisma.user.create({ data: { email: `wf-a-${Date.now()}@test.local` } });
  const userB = await prisma.user.create({ data: { email: `wf-b-${Date.now()}@test.local` } });

  try {
    const goal = analyzeDeterministic('Post about our AI automation product on facebook with an infographic');
    const planned = planWorkflow(goal);
    check('planner ok', planned.ok, planned);
    if (!planned.ok) return;

    // Create run + nodes for tenant A.
    const run = await createRun({ ownerId: userA.id, goal, plan: planned.plan, status: 'planned' });
    await createNodes(run.id, userA.id, planned.plan.nodes.map((n) => ({ nodeId: n.nodeId, agentId: n.agentId, dependsOn: n.dependsOn })));
    check('run created', Boolean(run.id));

    const full = await getRunWithNodes(run.id, userA.id);
    check('run round-trips with nodes', full?.nodes.length === planned.plan.nodes.length, full?.nodes.length);
    check('node dependsOn persisted', (full?.nodes.find((n) => n.agentId === 'publisher')?.dependsOn.length ?? 0) >= 1, full?.nodes.find((n) => n.agentId === 'publisher')?.dependsOn);

    // Tenant isolation: B cannot read A's run.
    const leak = await getRunForOwner(run.id, userB.id);
    check('cross-tenant read → null (isolation)', leak === null);

    // Artifact store: valid content_concept persists; junk is rejected at boundary.
    const cwNode = planned.plan.nodes.find((n) => n.agentId === 'concept_writer')!;
    const art = await putArtifact(run.id, userA.id, cwNode.nodeId, 'content_concept', {
      mainAngle: 'AI saves time', keyMessage: 'Automate marketing', copy: { body: 'b', threads: 't', x: 'x' }, postId: userA.id, // any uuid
    });
    check('valid artifact stored', Boolean(art.id));

    let rejected = false;
    try {
      await putArtifact(run.id, userA.id, cwNode.nodeId, 'content_concept', { mainAngle: 'x' });
    } catch (e) { rejected = e instanceof ArtifactValidationError; }
    check('malformed artifact rejected at boundary', rejected);

    const arts = await listArtifacts(run.id);
    check('listArtifacts returns the stored one', arts.length === 1, arts.length);

    // Guarded transition: planned → running, then stale re-transition fails.
    const t1 = await transitionRun(run.id, userA.id, 'planned', 'running');
    check('transition planned→running', t1?.status === 'running', t1?.status);
    const t2 = await transitionRun(run.id, userA.id, 'planned', 'running');
    check('stale re-transition → null (guard)', t2 === null);
    // Cross-tenant transition fails.
    const t3 = await transitionRun(run.id, userB.id, 'running', 'completed');
    check('cross-tenant transition → null', t3 === null);
  } finally {
    // Cascade deletes runs/nodes/artifacts via FK.
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    console.log('cleanup: 2 throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — persistence checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
