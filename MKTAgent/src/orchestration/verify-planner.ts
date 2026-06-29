// Phase 1 verification — pure, no DB, no LLM. Asserts the rule-based planner
// emits the exact DAG node sets + depends_on for the brief's three variants
// (§7.10), that the validator passes them, and that a malformed/empty goal yields
// a recoverable error (not a throw). Exits non-zero on any failure.
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { agentIdList } from './schemas/workflow-plan.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

const mkGoal = (outputs: Partial<GoalSpec['outputs']>, platforms: string[] = ['facebook']): GoalSpec =>
  goalSpec.parse({
    outputs,
    platforms,
    slots: { product: 'AI automation suite' },
    provider: 'test',
  });

// Variant A — text-only: concept_writer → publisher.
{
  console.log('Variant A: text-only');
  const r = planWorkflow(mkGoal({ needsTextPost: true, needsPublishing: true }));
  check('plan ok', r.ok, r);
  if (r.ok) {
    check('agents = [concept_writer, publisher]', JSON.stringify(agentIdList(r.plan)) === JSON.stringify(['concept_writer', 'publisher']), agentIdList(r.plan));
    const pub = r.plan.nodes.find((n) => n.agentId === 'publisher')!;
    const cw = r.plan.nodes.find((n) => n.agentId === 'concept_writer')!;
    check('publisher depends_on concept_writer', pub.dependsOn.includes(cw.nodeId), pub.dependsOn);
    check('publisher requiresApproval', pub.requiresApproval === true);
  }
}

// Variant B — text + infographic: concept_writer → infographic → publisher.
{
  console.log('Variant B: text + infographic');
  const r = planWorkflow(mkGoal({ needsTextPost: true, needsInfographic: true, needsPublishing: true }, ['facebook', 'linkedin']));
  check('plan ok', r.ok, r);
  if (r.ok) {
    check('agents = [concept_writer, infographic, publisher]', JSON.stringify(agentIdList(r.plan)) === JSON.stringify(['concept_writer', 'infographic', 'publisher']), agentIdList(r.plan));
    const info = r.plan.nodes.find((n) => n.agentId === 'infographic')!;
    const cw = r.plan.nodes.find((n) => n.agentId === 'concept_writer')!;
    const pub = r.plan.nodes.find((n) => n.agentId === 'publisher')!;
    check('infographic depends_on concept_writer', info.dependsOn.includes(cw.nodeId), info.dependsOn);
    check('publisher depends_on concept_writer + infographic', pub.dependsOn.includes(cw.nodeId) && pub.dependsOn.includes(info.nodeId), pub.dependsOn);
  }
}

// Variant C — text + infographic + video: full pipeline.
{
  console.log('Variant C: text + infographic + video');
  const r = planWorkflow(mkGoal({ needsResearch: true, needsTextPost: true, needsInfographic: true, needsVideo: true, needsPublishing: true }));
  check('plan ok', r.ok, r);
  if (r.ok) {
    const ids = agentIdList(r.plan);
    check('agents = [content_search, concept_writer, infographic, storyboard, video, publisher]',
      JSON.stringify(ids) === JSON.stringify(['content_search', 'concept_writer', 'infographic', 'storyboard', 'video', 'publisher']), ids);
    const cw = r.plan.nodes.find((n) => n.agentId === 'concept_writer')!;
    const sb = r.plan.nodes.find((n) => n.agentId === 'storyboard')!;
    const vid = r.plan.nodes.find((n) => n.agentId === 'video')!;
    check('storyboard depends_on concept_writer', sb.dependsOn.includes(cw.nodeId), sb.dependsOn);
    check('video depends_on storyboard', vid.dependsOn.includes(sb.nodeId), vid.dependsOn);
  }
}

// Variant D — full branding campaign: ideation → strategy → concept_writer →
// infographic → publisher. strategy implies ideation; copy depends on strategy.
{
  console.log('Variant D: full branding campaign');
  const r = planWorkflow(mkGoal({ needsIdeation: true, needsStrategy: true, needsTextPost: true, needsInfographic: true, needsPublishing: true }));
  check('plan ok', r.ok, r);
  if (r.ok) {
    const ids = agentIdList(r.plan);
    check('agents = [ideation, strategy, concept_writer, infographic, publisher]',
      JSON.stringify(ids) === JSON.stringify(['ideation', 'strategy', 'concept_writer', 'infographic', 'publisher']), ids);
    const idea = r.plan.nodes.find((n) => n.agentId === 'ideation')!;
    const strat = r.plan.nodes.find((n) => n.agentId === 'strategy')!;
    const cw = r.plan.nodes.find((n) => n.agentId === 'concept_writer')!;
    check('strategy depends_on ideation', strat.dependsOn.includes(idea.nodeId), strat.dependsOn);
    check('concept_writer depends_on strategy (optional satisfied)', cw.dependsOn.includes(strat.nodeId), cw.dependsOn);
  }
}

// Variant E — strategy requested without ideation flag → planner implies ideation
// (strategy.requires campaign_ideas must be satisfiable).
{
  console.log('Variant E: strategy implies ideation');
  const r = planWorkflow(mkGoal({ needsStrategy: true, needsTextPost: true, needsPublishing: true }));
  check('plan ok', r.ok, r);
  if (r.ok) {
    const ids = agentIdList(r.plan);
    check('ideation present before strategy', ids.indexOf('ideation') >= 0 && ids.indexOf('ideation') < ids.indexOf('strategy'), ids);
  }
}

// Negative — empty outputs → recoverable error, no throw.
{
  console.log('Negative: empty goal');
  const r = planWorkflow(mkGoal({ needsTextPost: false, needsPublishing: false }));
  check('returns recoverable error (not throw)', !r.ok, r);
  if (!r.ok) check('error = no_agents_selected', r.error === 'no_agents_selected', r.error);
}

console.log(failures === 0 ? '\nPASS — all planner checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
