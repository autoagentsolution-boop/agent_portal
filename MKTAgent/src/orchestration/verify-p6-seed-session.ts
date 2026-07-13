// P6 browser-validation helper: mint a throwaway test tenant with the data the demo scenarios need, then
// print its session cookie handle so agent-browser can drive the REAL UI as that user.
//   - seeds 2 leads (P3 email-by-name: one "Nghiep", plus a second so ambiguity/search is real)
//   - a workspace Instruction (P4: ideas should reflect it)
//   - a durable memory fact (P5: recall in chat)
// Prints: USERID, COOKIE (mkt_session handle). Does NOT clean up (the browser session needs it); a
// companion --cleanup <userId> mode removes it after.  npx tsx src/orchestration/verify-p6-seed-session.ts
import { prisma } from '../db/client.ts';
import { createSession } from '../lib/session.ts';
import { createLead } from '../db/repos/lead-repo.ts';
import { createInstruction } from '../db/repos/instruction-repo.ts';
import { rememberKeyed } from '../db/repos/user-memory-repo.ts';

async function cleanup(userId: string): Promise<void> {
  await prisma.userMemory.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.instruction.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.session.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.agentChatSession.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.workflowRun.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  console.log(`cleaned up ${userId}`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--cleanup' && process.argv[3]) { await cleanup(process.argv[3]!); process.exit(0); }

  const user = await prisma.user.create({ data: { email: `p6-demo-${Date.now()}@test.local`, defaultLanguage: 'en', accountType: 'business', brandVoice: 'Warm, expert, concise' } });
  await createLead({ ownerId: user.id, name: 'Nghiep', email: 'nghiep.demo@gmail.com', phone: null, message: 'Interested in the automation course', sourceProduct: 'AI Automation Course', source: 'form', calBookingUid: null, score: 72, scoreReasons: [] });
  await createLead({ ownerId: user.id, name: 'Lam Tran', email: 'lam.demo@example.com', phone: null, message: 'Asked about pricing', sourceProduct: 'AI Automation Course', source: 'form', calBookingUid: null, score: 55, scoreReasons: [] });
  await createInstruction({ ownerId: user.id, scope: 'workspace', agentId: null, content: 'Always use a witty, punchy tone and target SME founders in Southeast Asia.' });
  await rememberKeyed(user.id, 'product', 'ai automation course', 'AI Automation Course: teaches founders to automate ops with AI agents', user.id);

  const { handle } = await createSession(user.id, 'agent-browser-p6');
  console.log(`USERID=${user.id}`);
  console.log(`COOKIE=${handle}`);
  process.exit(0);
}

void main();
