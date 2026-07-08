// Atria v2 P2-2a verification — the Memory Agent learn→propose→approve→apply loop. Proves: the
// signal gate (needs >= MIN_EDITS hand-edited posts), the analysis returns proposals (DRY stub LLM —
// no spend), and — the success criterion — an ACCEPTED memory becomes a source:'memory' instruction
// that resolveInstructions injects into concept_writer's prompt (so future copy honours it) while a
// DIFFERENT agent (ideation) and a DIFFERENT tenant do NOT see it. Throwaway tenants.
import { prisma } from '../db/client.ts';
import { proposeMemories, MEMORY_TARGET_AGENT } from './atria/memory-agent.ts';
import type { LlmJsonFn } from './master/llm-json.ts';
import { createInstruction } from '../db/repos/instruction-repo.ts';
import { resolveInstructions } from './prompts/resolve-instructions.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const LEARNED = 'Keep copy to under 3 short sentences, no emoji, end with a direct CTA.';
// DRY stub: returns a fixed proposal, never reports usage (so verification records no spend).
const stubLlm: LlmJsonFn = async () => ({ proposals: [{ content: LEARNED, rationale: 'Every edited post is terse, emoji-free, CTA-ended.' }] });

async function seedEditedPosts(ownerId: string, campaignId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await prisma.post.create({
      data: { ownerId, campaignId, copyEdited: true, copy: { body: `Edited post ${i}. Short. Buy now.` } },
    });
  }
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `mem-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const other = await prisma.user.create({ data: { email: `mem-other-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: {
      ownerId: user.id, product: 'AI automation platform', brandContext: 'Automates ops.', platforms: ['facebook'],
      postingWindow: '09:00-11:00', timezone: 'Asia/Bangkok', language: 'en',
    } });

    // ── Signal gate: below threshold → no proposals ────────────────────────────────────────────
    await seedEditedPosts(user.id, campaign.id, 2);
    const under = await proposeMemories(user.id, stubLlm);
    check('gate: 2 edits (< min) → no proposals', under.proposals.length === 0 && under.editedCount === 2, under);

    // ── Enough signal → proposals returned from analysis ───────────────────────────────────────
    await seedEditedPosts(user.id, campaign.id, 2); // now 4 edited posts total
    const res = await proposeMemories(user.id, stubLlm);
    check('analyze: >= min edits → proposals returned', res.proposals.length === 1, res.proposals.length);
    check('analyze: editedCount = 4', res.editedCount === 4, res.editedCount);
    check('analyze: proposal targets concept_writer', res.proposals[0]?.agentId === MEMORY_TARGET_AGENT, res.proposals[0]?.agentId);

    // ── Approve → persist as source:'memory' instruction ───────────────────────────────────────
    const mem = await createInstruction({ ownerId: user.id, scope: 'workspace', agentId: MEMORY_TARGET_AGENT, content: res.proposals[0]!.content, source: 'memory' });
    check('accept: stored with source=memory', mem.source === 'memory', mem.source);

    // ── APPLIED: resolveInstructions injects it into concept_writer, not ideation ───────────────
    const forWriter = await resolveInstructions({ ownerId: user.id, agentId: MEMORY_TARGET_AGENT, campaignId: campaign.id });
    check('apply: concept_writer prompt includes the learned rule', forWriter.includes(LEARNED), forWriter);
    const forIdeation = await resolveInstructions({ ownerId: user.id, agentId: 'ideation', campaignId: campaign.id });
    check('apply: agent-targeted — ideation does NOT get it', !forIdeation.includes(LEARNED), forIdeation);

    // ── Tenant isolation ───────────────────────────────────────────────────────────────────────
    const forOther = await resolveInstructions({ ownerId: other.id, agentId: MEMORY_TARGET_AGENT, campaignId: campaign.id });
    check('isolation: other tenant does NOT get the memory', !forOther.includes(LEARNED), forOther);
    const otherPropose = await proposeMemories(other.id, stubLlm);
    check('isolation: other tenant has no edited posts → no proposals', otherPropose.proposals.length === 0, otherPropose);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: other.id } });
    console.log('cleanup: throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — memory agent loop green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
