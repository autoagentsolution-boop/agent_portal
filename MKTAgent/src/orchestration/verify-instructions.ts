// Phase 02 verification — the layered user-instruction system. Proves resolveInstructions
// composes workspace → campaign → post (+ agent-scoped) in the right order, respects enabled +
// agent targeting, reaches MULTIPLE agents through buildAgentPrompt, and that a user instruction
// which fights a hard guardrail cannot break the copy contract (guardrails still win). One
// throwaway tenant, cleaned up after.
import { prisma } from '../db/client.ts';
import { resolveInstructions } from './prompts/resolve-instructions.ts';
import { buildAgentPrompt } from './prompts/build-agent-prompt.ts';
import { buildGeminiBody } from '../copygen/prompt.ts';
import { getPostForCopyGen } from '../db/repos/post-repo.ts';
import { createInstruction } from '../db/repos/instruction-repo.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const idxOf = (arr: string[], needle: string): number => arr.findIndex((s) => s.includes(needle));

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `instr-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: { ownerId: user.id, product: 'AI automation platform', platforms: ['facebook'] } });
    const post = await prisma.post.create({ data: { campaignId: campaign.id, ownerId: user.id, status: 'brief', platforms: ['facebook'] } });

    // Seed a realistic layered set.
    const wsGeneral = await createInstruction({ ownerId: user.id, scope: 'workspace', content: 'Always end the body with a specific question.' });
    const wsBad = await createInstruction({ ownerId: user.id, scope: 'workspace', content: 'Write at least 5000 characters.' }); // fights length guardrail
    const wsStoryboard = await createInstruction({ ownerId: user.id, scope: 'workspace', agentId: 'storyboard', content: 'Minimalist visuals, lots of whitespace.' });
    const wsIdeation = await createInstruction({ ownerId: user.id, scope: 'workspace', agentId: 'ideation', content: 'Only bold, contrarian angles.' });
    const camp = await createInstruction({ ownerId: user.id, scope: 'campaign', scopeRefId: campaign.id, content: 'Reference our Q3 launch.' });
    const postScoped = await createInstruction({ ownerId: user.id, scope: 'post', scopeRefId: post.id, content: 'Mention the 20% discount.' });
    await createInstruction({ ownerId: user.id, scope: 'workspace', enabled: false, content: 'DISABLED should never appear.' });

    // ── storyboard run: workspace + campaign + post + agent-scoped(storyboard) ────────────────
    const sb = await resolveInstructions({ ownerId: user.id, agentId: 'storyboard', campaignId: campaign.id, postId: post.id });
    check('storyboard: workspace-general included', idxOf(sb, wsGeneral.content) >= 0, sb);
    check('storyboard: campaign-scoped included', idxOf(sb, camp.content) >= 0);
    check('storyboard: post-scoped included', idxOf(sb, postScoped.content) >= 0);
    check('storyboard: agent-scoped(storyboard) included', idxOf(sb, wsStoryboard.content) >= 0);
    check('storyboard: agent-scoped(ideation) EXCLUDED (different agent)', idxOf(sb, wsIdeation.content) < 0);
    check('storyboard: disabled EXCLUDED', idxOf(sb, 'DISABLED') < 0);
    check('storyboard: order workspace < campaign < post', idxOf(sb, wsGeneral.content) < idxOf(sb, camp.content) && idxOf(sb, camp.content) < idxOf(sb, postScoped.content), sb);
    check('storyboard: general precedes agent-scoped within workspace', idxOf(sb, wsGeneral.content) < idxOf(sb, wsStoryboard.content));

    // ── ideation run (no campaign/post yet — fresh goal): only workspace layers apply ─────────
    const idea = await resolveInstructions({ ownerId: user.id, agentId: 'ideation' });
    check('ideation: workspace-general included', idxOf(idea, wsGeneral.content) >= 0);
    check('ideation: agent-scoped(ideation) included', idxOf(idea, wsIdeation.content) >= 0);
    check('ideation: agent-scoped(storyboard) EXCLUDED', idxOf(idea, wsStoryboard.content) < 0);
    check('ideation: campaign/post EXCLUDED (no ref in ctx)', idxOf(idea, camp.content) < 0 && idxOf(idea, postScoped.content) < 0);

    // ── reaches multiple agents via buildAgentPrompt, contract stays LAST ─────────────────────
    const sbPrompt = buildAgentPrompt('storyboard', { language: 'English', userInstructions: sb });
    check('builder: storyboard system carries the user instructions', sbPrompt.system.includes(wsGeneral.content) && sbPrompt.system.includes(postScoped.content));
    check('builder: USER INSTRUCTIONS block present', /USER INSTRUCTIONS/.test(sbPrompt.system));
    check('builder: hard output contract still LAST (wins over instructions)', sbPrompt.system.trimEnd().endsWith(sbPrompt.contract.trimEnd()));
    check('builder: instructions precede the contract', sbPrompt.system.indexOf('USER INSTRUCTIONS') < sbPrompt.system.indexOf(sbPrompt.contract));

    const ideaPrompt = buildAgentPrompt('ideation', { language: 'English', userInstructions: idea });
    check('builder: SAME workspace instruction also reaches ideation', ideaPrompt.system.includes(wsGeneral.content));

    // ── copy-gen: a user instruction that fights a hard guardrail cannot break the contract ───
    const pwc = await getPostForCopyGen(post.id, user.id);
    if (!pwc) { check('copy: post loaded', false); return; }
    const body = buildGeminiBody(pwc, undefined, null, [wsGeneral.content, wsBad.content]);
    const sysText = body.systemInstruction.parts[0]!.text;
    check('copy: user instructions injected', sysText.includes(wsGeneral.content) && sysText.includes(wsBad.content));
    check('copy: hard hook guardrail STILL present (guardrail not removed)', /MAX 50 CHARACTERS/.test(sysText));
    check('copy: hard guardrail appears AFTER user instructions (wins by position)', sysText.indexOf('USER INSTRUCTIONS') < sysText.indexOf('MAX 50 CHARACTERS'));
    check('copy: JSON responseSchema unchanged (still body/threads/x)', JSON.stringify((body.generationConfig as any).responseSchema?.required) === JSON.stringify(['body', 'threads', 'x']));

    // No instructions → no block (regression: unchanged prompt for tenants with none).
    const clean = buildGeminiBody(pwc, undefined, null, []);
    check('copy: no instructions → no USER INSTRUCTIONS block', !/USER INSTRUCTIONS/.test(clean.systemInstruction.parts[0]!.text));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — user-instruction checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
