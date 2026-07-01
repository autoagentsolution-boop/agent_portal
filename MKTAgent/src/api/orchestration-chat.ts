// Chat persistence for the orchestration surface (conversational unify). Mirrors the
// inline prisma writes in agent-router.ts but extracted so orchestration-router stays
// lean. Each orchestration turn becomes a (user → agent) message pair on an
// AgentChatSession, so runs appear in the sidebar "Chats" list and history restores.
import { prisma } from '../db/client.ts';
import { conversationAuthor, type PriorMessage } from '../orchestration/master/conversation-author.ts';
import { saveOfferAuthor } from '../orchestration/master/save-offer-author.ts';
import { detectLanguage } from '../orchestration/master/detect-language.ts';
import type { MasterAgentOutcome } from '../orchestration/master/master-agent.ts';
import type { GoalSpec } from '../orchestration/schemas/goal-spec.ts';

const titleFrom = (message: string): string =>
  message.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Orchestration goal';

// Ensure a chat session backs this run. Reuses the caller's session when valid +
// owned; otherwise opens a new one titled from the first message. Returns the id.
export const ensureChatSession = async (
  ownerId: string,
  chatSessionId: string | undefined,
  firstMessage: string,
): Promise<string> => {
  if (chatSessionId) {
    const existing = await prisma.agentChatSession.findFirst({ where: { id: chatSessionId, ownerId } });
    if (existing) return existing.id;
  }
  const session = await prisma.agentChatSession.create({ data: { ownerId, title: titleFrom(firstMessage) } });
  return session.id;
};

const priorMessages = async (sessionId: string): Promise<PriorMessage[]> => {
  const rows = await prisma.agentChatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return rows.map((m) => ({ role: m.role === 'user' ? 'user' : 'agent', content: m.content }));
};

// Record one turn: persist the user's message, author the assistant reply from the
// outcome (with prior context), persist it, and bump the session so it sorts to the
// top of the sidebar. Returns the assistant message for the DTO. Author never throws
// (degrades to a deterministic sentence), so a turn always lands.
export const recordTurn = async (
  sessionId: string,
  userMessage: string,
  outcome: MasterAgentOutcome,
): Promise<string> => {
  await prisma.agentChatMessage.create({ data: { sessionId, role: 'user', content: userMessage } });
  const prior = await priorMessages(sessionId);
  // Language: pass the raw message so the model mirrors its language (ANY language),
  // plus a detected code hint when the script is unambiguous (an explicit
  // goal.slots.language still wins inside the author). Fixes wrong-language replies.
  const language = detectLanguage(userMessage);
  const assistantMessage = await conversationAuthor.author(outcome, prior, { userMessage, language });
  await prisma.agentChatMessage.create({ data: { sessionId, role: 'agent', content: assistantMessage } });
  // Touch the session so it sorts to the top of the sidebar (child message inserts
  // don't bump the parent's @updatedAt on their own).
  await prisma.agentChatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  return assistantMessage;
};

// Record the "flow saved — what next?" agent turn (P6). Unlike recordTurn there is no
// user message: saving is a UI action, so we persist only the agent's guiding offer so
// it shows in the transcript + survives history restore. Language mirrors the saved
// goal (name/product). Author never throws (deterministic fallback). Returns the text.
export const recordSaveOffer = async (
  sessionId: string,
  flowName: string | null,
  goal: GoalSpec,
): Promise<string> => {
  const product = goal.slots.product ?? null;
  const language = goal.slots.language ?? detectLanguage(flowName ?? product ?? '');
  const message = await saveOfferAuthor.author({ flowName, product, language });
  await prisma.agentChatMessage.create({ data: { sessionId, role: 'agent', content: message } });
  await prisma.agentChatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  return message;
};

// Readable one-line summary of clarification answers → the user-side chat message
// (the user "said" their answers). Slots map to labels the assistant restates.
const SLOT_LABEL: Record<string, string> = {
  product: 'Product',
  output_format: 'Produce',
  platforms: 'Platforms',
  targetAudience: 'Audience',
  angle: 'Angle',
};

export const summarizeAnswers = (answers: Record<string, string | string[]>): string => {
  const parts = Object.entries(answers)
    .filter(([, v]) => (Array.isArray(v) ? v.length : String(v).trim()))
    .map(([slot, v]) => `${SLOT_LABEL[slot] ?? slot}: ${Array.isArray(v) ? v.join(', ') : v}`);
  return parts.length ? parts.join(' · ') : 'Continue';
};
