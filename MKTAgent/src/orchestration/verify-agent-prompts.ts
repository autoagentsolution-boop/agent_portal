// Phase 01 verification — the shared prompt builder emits a well-formed, expert-grade
// system prompt for every builder-routed agent, the JSON output contract is preserved
// and ALWAYS last (so it wins over persona + user instructions), and the Phase 02
// user-instruction seam injects only when instructions are present. Pure — no DB, no LLM.
import { buildAgentPrompt } from './prompts/build-agent-prompt.ts';
import { AGENT_OUTPUT_CONTRACTS } from './prompts/agent-prompts.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Every builder-routed agent gets an expert base (persona + capabilities + quality bar),
// the language rule, and its exact output contract — assembled from ONE builder.
const cases = [
  { agent: 'ideation' as const, key: undefined, persona: /ideation strategist/i, shape: '"ideas"' },
  { agent: 'strategy' as const, key: undefined, persona: /marketing strategist/i, shape: '"positioning"' },
  { agent: 'storyboard' as const, key: undefined, persona: /storyboard director/i, shape: '"frames"' },
  { agent: 'storyboard' as const, key: 'storyboard_carousel' as const, persona: /storyboard director/i, shape: 'swipe' },
];

for (const c of cases) {
  const label = c.key ?? c.agent;
  const { system, contract } = buildAgentPrompt(c.agent, { language: 'English', contractKey: c.key });
  check(`${label}: persona present`, c.persona.test(system), system.slice(0, 80));
  check(`${label}: capabilities framework present`, /You are expert at:/.test(system));
  check(`${label}: quality bar present`, /Operating principles & quality bar:/.test(system));
  check(`${label}: language rule present`, /LANGUAGE: write all user-facing text entirely in English/.test(system));
  check(`${label}: output contract present`, system.includes(contract) && contract.includes(c.shape), c.shape);
  check(`${label}: contract is LAST (wins over persona)`, system.trimEnd().endsWith(contract.trimEnd()));
  check(`${label}: JSON-only rule preserved`, /Output JSON only\. No prose, no markdown fences\./.test(system));
}

// DRY-RUN stub matcher (verify-executor.ts) keys off /ideation/i and /storyboard/i in the
// system prompt — routing through the builder must not break that contract.
check('stub matcher: ideation system matches /ideation/i', /ideation/i.test(buildAgentPrompt('ideation', { language: 'English' }).system));
check('stub matcher: storyboard system matches /storyboard/i', /storyboard/i.test(buildAgentPrompt('storyboard', { language: 'English' }).system));
check('stub matcher: strategy system NOT caught by /ideation|storyboard/i (falls through)',
  !/ideation|storyboard/i.test(buildAgentPrompt('strategy', { language: 'English' }).system));

// Phase 02 seam: user instructions inject a clearly-delimited block BEFORE the contract
// (which still wins), and are absent when none are supplied.
const noInstr = buildAgentPrompt('ideation', { language: 'English' }).system;
check('no user instructions → no USER INSTRUCTIONS block', !/USER INSTRUCTIONS/.test(noInstr));
const withInstr = buildAgentPrompt('ideation', {
  language: 'English',
  userInstructions: ['Always end with a question', 'Never use emojis'],
});
check('user instructions → block injected', /USER INSTRUCTIONS/.test(withInstr.system));
check('user instructions → each line present', /Always end with a question/.test(withInstr.system) && /Never use emojis/.test(withInstr.system));
check('user instructions precede the hard contract (contract still last)',
  withInstr.system.indexOf('USER INSTRUCTIONS') < withInstr.system.indexOf(withInstr.contract));

// Every declared contract is non-empty and self-labels as the hard, overriding block.
for (const [k, v] of Object.entries(AGENT_OUTPUT_CONTRACTS)) {
  check(`contract '${k}' is hard + non-empty`, v.length > 0 && /OUTPUT CONTRACT \(hard rules/.test(v));
}

// Unknown contract key fails loud rather than silently emitting a base-only prompt.
let threw = false;
try { buildAgentPrompt('ideation', { language: 'English', contractKey: 'nope' as never }); } catch { threw = true; }
check('unknown contract key throws', threw);

console.log(failures === 0 ? '\nPASS — prompt builder checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
