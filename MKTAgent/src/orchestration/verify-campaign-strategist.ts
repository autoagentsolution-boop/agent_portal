// Phase 03 verification — campaign intent → editable content calendar. Proves the analyzer
// detects campaign scope + duration/cadence, the planner routes a campaign goal to
// content_search? → ideation → strategy → campaign_strategist (and STOPS — no per-post
// media/publish), the single-scope path is UNCHANGED, and the strategist runner emits a
// schema-valid N-slot calendar via the shared expert builder. DRY-RUN stub LLM — no spend.
import { randomUUID } from 'node:crypto';
import { prisma } from '../db/client.ts';
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import { getRunner, type RunnerContext } from './executor/agent-runners.ts';
import { buildAgentPrompt } from './prompts/build-agent-prompt.ts';
import { contentCalendar } from './schemas/artifact-schemas.ts';
import type { LlmJsonFn } from './master/llm-json.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const agentIdsOf = (plan: { nodes: Array<{ agentId: string }> }): string[] => plan.nodes.map((n) => n.agentId);

async function main(): Promise<void> {
  // ── Analyzer: multi-post intent → campaign scope + duration/cadence ───────────────────────
  const campaignGoal = analyzeDeterministic('Plan a month of content, 3 posts a week, for our AI automation platform on facebook and instagram');
  check('analyzer: campaign scope detected', campaignGoal.campaignScope === 'campaign', campaignGoal.campaignScope);
  check('analyzer: duration = 4 weeks', campaignGoal.duration?.weeks === 4, campaignGoal.duration);
  check('analyzer: cadence = 3/week', campaignGoal.cadence?.postsPerWeek === 3, campaignGoal.cadence);

  // ── Planner: campaign goal routes to the strategist and STOPS ─────────────────────────────
  const cp = planWorkflow(campaignGoal);
  check('planner: campaign plan ok', cp.ok, cp);
  if (cp.ok) {
    const ids = agentIdsOf(cp.plan);
    check('planner: includes campaign_strategist', ids.includes('campaign_strategist'), ids);
    check('planner: includes ideation + strategy', ids.includes('ideation') && ids.includes('strategy'), ids);
    check('planner: NO per-post concept/media/publisher', !ids.some((i) => ['concept_writer', 'infographic', 'storyboard', 'video', 'publisher'].includes(i)), ids);
    const strat = cp.plan.nodes.find((n) => n.agentId === 'campaign_strategist')!;
    const stratNode = cp.plan.nodes.find((n) => n.agentId === 'strategy')!;
    check('planner: strategist depends on strategy (grounding)', strat.dependsOn.includes(stratNode.nodeId), strat.dependsOn);
  }

  // ── Single scope UNCHANGED (regression) ───────────────────────────────────────────────────
  const single = analyzeDeterministic('Write a facebook post about our AI automation platform');
  check('analyzer: plain post stays single scope', single.campaignScope === 'single', single.campaignScope);
  const sp = planWorkflow(single);
  check('planner: single plan ok', sp.ok);
  if (sp.ok) {
    const ids = agentIdsOf(sp.plan);
    check('planner: single has concept_writer + publisher', ids.includes('concept_writer') && ids.includes('publisher'), ids);
    check('planner: single has NO strategist', !ids.includes('campaign_strategist'), ids);
  }

  // Bare "branding campaign" must NOT escalate scope (would break the rich single-post flow).
  const branding = analyzeDeterministic('Build a full branding campaign for our AI automation product on facebook with an infographic');
  check('analyzer: bare "campaign" word stays single', branding.campaignScope === 'single', branding.campaignScope);
  const bp = planWorkflow(branding);
  check('planner: branding keeps single pipeline (concept+infographic+publisher, no strategist)',
    bp.ok && agentIdsOf(bp.plan).includes('infographic') && agentIdsOf(bp.plan).includes('publisher') && !agentIdsOf(bp.plan).includes('campaign_strategist'),
    bp.ok ? agentIdsOf(bp.plan) : bp);

  // ── Builder: strategist prompt is expert-grade + carries the slots contract ────────────────
  const built = buildAgentPrompt('campaign_strategist', { language: 'English' });
  check('builder: strategist persona present', /campaign strategist/i.test(built.system));
  check('builder: slots output contract present + last', built.system.includes('"slots"') && built.system.trimEnd().endsWith(built.contract.trimEnd()));

  // ── Runner: campaign goal → schema-valid N-slot calendar (stub LLM, no spend) ─────────────
  // Fixed calendar the stub returns; distinct pillars/formats, platforms ⊆ target.
  const stubSlots = [
    { index: 0, pillar: 'Awareness', angle: 'Problem framing', format: 'text', platforms: ['facebook'], hook: 'Still doing X by hand?', rationale: 'Open the arc', dayOffset: 0 },
    { index: 1, pillar: 'Education', angle: 'How it works', format: 'carousel', platforms: ['instagram'], hook: 'Here is the flow', rationale: 'Explain', dayOffset: 2 },
    { index: 2, pillar: 'Proof', angle: 'Case result', format: 'image', platforms: ['facebook', 'instagram'], hook: '3x faster', rationale: 'Build trust', dayOffset: 5 },
    { index: 3, pillar: 'Conversion', angle: 'Offer', format: 'video', platforms: ['facebook'], hook: 'Try it free', rationale: 'Convert', dayOffset: 9 },
  ];
  let capturedUser = '';
  const stubLlm: LlmJsonFn = async (_system, user) => { capturedUser = user; return { slots: stubSlots }; };

  const goal = { ...campaignGoal, slots: { ...campaignGoal.slots, language: 'English', product: 'AI automation platform' } };
  const ctx: RunnerContext = {
    runId: randomUUID(),
    ownerId: randomUUID(), // no such user needed: strategist writes nothing, instruction query → []
    goal,
    upstream: { strategy_brief: { pillars: ['Awareness', 'Education', 'Proof', 'Conversion'], funnelStage: 'consideration' } },
    llmJsonFn: stubLlm,
  };
  const out = await getRunner('campaign_strategist')(ctx);
  check('runner: produces content_calendar', out.type === 'content_calendar');
  const parsed = contentCalendar.safeParse(out.data);
  check('runner: calendar schema-valid', parsed.success, parsed.success ? undefined : parsed.error.issues[0]);
  if (parsed.success) {
    const slots = parsed.data.slots;
    check('runner: ≥1 slot', slots.length >= 1);
    check('runner: all formats valid', slots.every((s) => ['text', 'image', 'carousel', 'video'].includes(s.format)));
    check('runner: platforms ⊆ target', slots.every((s) => s.platforms.every((p) => ['facebook', 'instagram'].includes(p))), slots.map((s) => s.platforms));
    check('runner: pillars rotate (≥3 distinct)', new Set(slots.map((s) => s.pillar)).size >= 3);
  }
  check('runner: prompt asks for EXACTLY 12 slots (4wk × 3/wk)', /EXACTLY 12 slots/.test(capturedUser), capturedUser.slice(0, 200));
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — campaign strategist checks green (0 spend)' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
