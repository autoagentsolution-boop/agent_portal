// Golden-master for the WorkflowPlanner (P1b.0 — the safety net for the C1 selectAgents refactor).
// Captures planWorkflow()'s output (selected agents + derived edges + gates) across a matrix of goals
// that exercises every branch of the current marketing selectAgents ladder. The upcoming data-driven
// selection refactor MUST reproduce these snapshots byte-for-byte — run this before and after; any diff
// is a regression to explain, not accept.
//
//   npx tsx src/orchestration/verify-planner-golden.ts            # compare vs snapshot (exit 1 on diff)
//   npx tsx src/orchestration/verify-planner-golden.ts --update   # (re)capture the baseline snapshot
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import { planWorkflow } from './master/workflow-planner.ts';

type Outputs = Partial<GoalSpec['outputs']>;
interface Case { name: string; outputs: Outputs; platforms?: GoalSpec['platforms']; scope?: GoalSpec['campaignScope'] }

// A representative goal per selectAgents branch. outputs are set EXPLICITLY (defaults are needsTextPost
// + needsPublishing = true) so each case pins exactly what it means. A product slot is set so content
// goals don't trip an unrelated missing-content path.
const CASES: Case[] = [
  { name: 'single-text-post', outputs: { needsTextPost: true, needsPublishing: true }, platforms: ['facebook'] },
  { name: 'single-post-multi-platform', outputs: { needsTextPost: true, needsPublishing: true }, platforms: ['facebook', 'instagram'] },
  { name: 'text-post-no-publish', outputs: { needsTextPost: true, needsPublishing: false } },
  { name: 'ideation-strategy-post', outputs: { needsIdeation: true, needsStrategy: true, needsTextPost: true, needsPublishing: true }, platforms: ['facebook'] },
  { name: 'research-post', outputs: { needsResearch: true, needsTextPost: true, needsPublishing: true }, platforms: ['facebook'] },
  { name: 'infographic-media-only', outputs: { needsTextPost: false, needsInfographic: true, needsPublishing: true }, platforms: ['instagram'] },
  { name: 'video-post', outputs: { needsTextPost: false, needsVideo: true, needsPublishing: true }, platforms: ['facebook'] },
  { name: 'video-no-publish', outputs: { needsTextPost: false, needsVideo: true, needsPublishing: false } },
  { name: 'storyboard-only', outputs: { needsTextPost: false, needsStoryboard: true, needsPublishing: false } },
  { name: 'full-stack-post', outputs: { needsResearch: true, needsIdeation: true, needsStrategy: true, needsTextPost: true, needsInfographic: true, needsVideo: true, needsPublishing: true }, platforms: ['facebook', 'instagram'] },
  { name: 'campaign-with-research', outputs: { needsResearch: true }, scope: 'campaign' },
  { name: 'campaign-no-research', outputs: {}, scope: 'campaign' },
  { name: 'spotlight', outputs: {}, scope: 'spotlight' },
  { name: 'email', outputs: { needsEmail: true, needsTextPost: false, needsPublishing: false } },
  { name: 'publish-only-edge', outputs: { needsTextPost: false, needsInfographic: false, needsVideo: false, needsStoryboard: false, needsPublishing: true } },
];

const buildGoal = (c: Case): GoalSpec =>
  goalSpec.parse({
    outputs: c.outputs,
    platforms: c.platforms ?? [],
    campaignScope: c.scope ?? 'single',
    ...(c.scope && c.scope !== 'single' ? { duration: { weeks: 4 }, cadence: { postsPerWeek: 3 } } : {}),
    slots: { product: 'GreenLeaf', productDetails: 'organic tea brand', emailTo: c.outputs.needsEmail ? 'friend@example.com' : null },
  });

// Deterministic, order-preserving snapshot of a plan: selected nodes (agentId + sorted deps + gate).
const snapshotCase = (c: Case): unknown => {
  const res = planWorkflow(buildGoal(c));
  if (!res.ok) return { name: c.name, ok: false, error: res.error };
  return {
    name: c.name,
    ok: true,
    nodes: res.plan.nodes.map((n) => ({ agentId: n.agentId, dependsOn: [...n.dependsOn].sort(), requiresApproval: n.requiresApproval })),
  };
};

const snapshot = CASES.map(snapshotCase);
const serialized = JSON.stringify(snapshot, null, 2);
const path = new URL('./planner-golden-snapshot.json', import.meta.url);
const update = process.argv.includes('--update');

if (update || !existsSync(path)) {
  writeFileSync(path, `${serialized}\n`, 'utf8');
  console.log(`[verify-planner-golden] baseline ${update ? 'UPDATED' : 'captured'} — ${CASES.length} cases → planner-golden-snapshot.json`);
  process.exit(0);
}

const expected = readFileSync(path, 'utf8').trim();
if (expected === serialized) {
  console.log(`[verify-planner-golden] PASS — all ${CASES.length} planner cases match the golden snapshot.`);
  process.exit(0);
}

// Diff: report which cases changed so a refactor regression is pinpointed, not just "mismatch".
const expArr = JSON.parse(expected) as Array<{ name: string }>;
const changed: string[] = [];
for (let i = 0; i < snapshot.length; i++) {
  if (JSON.stringify(snapshot[i]) !== JSON.stringify(expArr[i])) changed.push(CASES[i]!.name);
}
console.error(`[verify-planner-golden] FAIL — ${changed.length} case(s) diverged from the golden snapshot:`);
for (const name of changed) {
  const i = CASES.findIndex((c) => c.name === name);
  console.error(`\n  ● ${name}\n    expected: ${JSON.stringify(expArr[i])}\n    actual:   ${JSON.stringify(snapshot[i])}`);
}
console.error(`\nIf this change is INTENTIONAL, re-run with --update to accept the new baseline.`);
process.exit(1);
