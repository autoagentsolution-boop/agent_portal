// Phase 2 verification — analyzer (deterministic path) + clarification engine +
// master-agent wiring. Pure, no DB. A live Gemini smoke runs only if GEMINI_API_KEY
// is set (otherwise the deterministic fallback is exercised, which is the contract).
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { evaluateClarification } from './master/clarification-engine.ts';
import { MasterAgent } from './master/master-agent.ts';
import { deterministicReply } from './master/conversation-author.ts';
import { agentIdList } from './schemas/workflow-plan.ts';
import { env } from '../config/env.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Deterministic intent extraction.
{
  console.log('Deterministic analyzer');
  const g = analyzeDeterministic('Make a Facebook and LinkedIn post with a short video for our AI automation product');
  check('detects facebook + linkedin', g.platforms.includes('facebook') && g.platforms.includes('linkedin'), g.platforms);
  check('needsVideo from "video"', g.outputs.needsVideo === true);
  check('needsTextPost default true', g.outputs.needsTextPost === true);
  check('product extracted', Boolean(g.slots.product), g.slots.product);

  const draftOnly = analyzeDeterministic('Write a draft only post about our course, do not publish');
  check('needsPublishing false on draft-only', draftOnly.outputs.needsPublishing === false);
}

// Clarification: missing product → asks (required).
{
  console.log('Clarification engine');
  const vague = analyzeDeterministic('Make me a marketing flow');
  const r = evaluateClarification(vague);
  check('vague (no product) → needs_clarification', r.status === 'needs_clarification', r);
  if (r.status === 'needs_clarification') {
    check('asks product (required)', r.questions.some((q) => q.slot === 'product' && q.required), r.questions);
    check('≤5 questions', r.questions.length <= 5, r.questions.length);
  }

  // RICHNESS GATE: product + a single platform but no audience/angle is too thin to
  // plan well — the old engine jumped straight to a bare DAG ("it's dumb"). Now it
  // must ask the high-impact targeting questions first.
  const thin = analyzeDeterministic('Post about our AI automation product on facebook');
  const rThin = evaluateClarification(thin);
  check('thin (product+platform only) → needs_clarification', rThin.status === 'needs_clarification', rThin);
  if (rThin.status === 'needs_clarification') {
    check('thin asks audience (required)', rThin.questions.some((q) => q.slot === 'targetAudience' && q.required), rThin.questions);
    check('thin asks angle (required)', rThin.questions.some((q) => q.slot === 'angle' && q.required), rThin.questions);
  }

  // No platform either → also thin, and the platforms question becomes required.
  const noPlatform = analyzeDeterministic('Post about our AI automation product');
  const rNo = evaluateClarification(noPlatform);
  check('no-platform thin → needs_clarification', rNo.status === 'needs_clarification', rNo);
  check('thin promotes platforms to required', rNo.status === 'needs_clarification' && rNo.questions.some((q) => q.slot === 'platforms' && q.required), rNo);

  // RICH: product + audience + angle (≥2 high-impact slots) → enough to plan, no gate.
  const rich = analyzeDeterministic('Post about our AI automation product on facebook, target audience is small business owners, angle is saving operational time');
  const rRich = evaluateClarification(rich);
  check('rich (product+audience+angle) → ready', rRich.status === 'ready', { status: rRich.status, slots: rich.slots, platforms: rich.platforms });
}

// Master agent end-to-end (deterministic): thin → clarify, rich → planned DAG.
{
  console.log('MasterAgent.planFromGoal');
  const agent = new MasterAgent();

  // The FB-post example from the screenshot: now asks before planning.
  const thin = analyzeDeterministic('Post about our AI automation product on facebook with an infographic');
  const outThin = agent.planFromGoal(thin);
  check('thin FB example → awaiting_clarification', outThin.status === 'awaiting_clarification', outThin.status);

  // Richly specified → plans the full DAG.
  const rich = analyzeDeterministic('Post about our AI automation product on facebook with an infographic, target audience is small business owners, angle is saving operational time');
  const out = agent.planFromGoal(rich);
  check('rich → planned', out.status === 'planned', out.status);
  if (out.status === 'planned') {
    check('plan has concept_writer + infographic + publisher',
      ['concept_writer', 'infographic', 'publisher'].every((a) => agentIdList(out.plan).includes(a as never)),
      agentIdList(out.plan));
  }

  const vague = analyzeDeterministic('help me with marketing');
  const out2 = agent.planFromGoal(vague);
  check('vague → awaiting_clarification', out2.status === 'awaiting_clarification', out2.status);
}

// Conversation author (deterministic fallback — no LLM needed). Voices each outcome.
{
  console.log('ConversationAuthor (deterministic fallback)');
  const agent = new MasterAgent();
  const thin = agent.planFromGoal(analyzeDeterministic('Post about our AI automation product on facebook'));
  const clarifyReply = deterministicReply(thin);
  check('clarify reply mentions a question', /audience|angle|platform/i.test(clarifyReply), clarifyReply);

  const rich = agent.planFromGoal(analyzeDeterministic('Post about our AI automation product on facebook, target audience is small business owners, angle is saving time'));
  const planReply = deterministicReply(rich);
  check('plan reply names approval + a step', /approve/i.test(planReply) && /publish|step|concept/i.test(planReply), planReply);
}

// Optional live Gemini smoke.
async function geminiSmoke(): Promise<void> {
  if (!env.GEMINI_API_KEY) { console.log('Gemini smoke: SKIPPED (no GEMINI_API_KEY)'); return; }
  console.log('Gemini smoke (live)');
  const { GeminiRequirementAnalyzer } = await import('./master/requirement-analyzer.ts');
  const g = await new GeminiRequirementAnalyzer().analyze('I want a short video post for my coffee shop on Instagram');
  check('gemini returns valid GoalSpec', g.goal === 'marketing_content', g);
  check('gemini detects instagram', g.platforms.includes('instagram'), g.platforms);
  check('gemini provider tagged', g.provider.startsWith('gemini') || g.provider === 'deterministic-v1', g.provider);
}

await geminiSmoke();
console.log(failures === 0 ? '\nPASS — all master/clarification checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
