// DM nurture node pair (dm_writer → dm_agent) — mirrors email_writer/email_agent
// (orchestration/executor/agent-runners.ts). A DM is 1:1, approval-gated, opt-in only, and uses a
// non-SocialPlatform credential (an env-level channel token, not a per-user OAuthToken row) — so,
// like email_agent, connectivity + the opt-in gate are checked INSIDE the runner rather than via the
// social connection-resolver. Every channel adapter (src/messaging/*) defaults to DRY-RUN; see
// sendDm/messaging/index.ts + types.ts's isLiveDmSend for the exact guard.
import { callGeminiJson } from '../orchestration/master/llm-json.ts';
import type { RunnerContext, RunnerOutput } from '../orchestration/executor/agent-runners.ts';
import { estimateLlmCost, costFromUsage, type GeminiUsage } from '../orchestration/executor/node-cost.ts';
import { recordLlmUsage } from '../cost/llm-usage.ts';
import { dmDraft, dmResult } from '../orchestration/schemas/artifact-schemas.ts';
import { getUserById } from '../db/repos/user-repo.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { sendDm } from './index.ts';
import { getOptInState, getOrCreateContactId, getDmMessageByRun, recordDmMessage } from './opt-in-repo.ts';
import type { MessagingChannel } from './types.ts';

const CHANNELS: ReadonlySet<string> = new Set<MessagingChannel>(['whatsapp', 'telegram', 'zalo']);
const isChannel = (c: string): c is MessagingChannel => CHANNELS.has(c);

// No attached post for a DM goal (self-contained, mirrors email_writer's fallback) — resolve
// language from the goal slot, else the owner's default, else English.
const resolveLanguage = async (ctx: RunnerContext): Promise<string> =>
  ctx.goal.slots.language?.trim() || (await getUserById(ctx.ownerId))?.defaultLanguage || 'en';

const DM_WRITER_PROMPT = [
  "You are Atria's DM Writer. Write ONE short, ready-to-send direct message based on the user's purpose.",
  'Warm, natural, human — never templated or spammy. Plain text only. This is a DM (WhatsApp/Telegram/Zalo),',
  'not an email: no subject line, no formal salutation block, under ~400 characters unless the purpose clearly',
  'needs more. Address the recipient by first name ONLY if the purpose/context explicitly names them — never',
  'guess a name. Ground in any provided context; invent no facts. Write ENTIRELY in the requested language.',
  'Respond ONLY as JSON: {"body":"the message text"}.',
].join(' ');

// dm_writer (LIVE): draft the message. Grounds on an upstream content_concept/summary/research_summary
// when present (a nurture flow), else drafts straight from the goal — mirrors runEmailWriter.
export const runDmWriter = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const channel = (ctx.goal.slots.dmChannel ?? '').trim().toLowerCase();
  if (!isChannel(channel)) {
    throw new Error(`dm_writer: unknown or missing channel — choose one of ${[...CHANNELS].join(', ')}.`);
  }
  const to = (ctx.goal.slots.dmTo ?? '').trim();
  if (!to) throw new Error('dm_writer: no recipient — tell me who to message (a phone number, chat id, or handle).');

  const call = ctx.llmJsonFn ?? callGeminiJson;
  const language = await resolveLanguage(ctx);
  const purpose = ctx.goal.slots.angle?.trim() || ctx.goal.slots.product?.trim() || 'a short, friendly message';
  const concept = ctx.upstream['content_concept'];
  const summary = ctx.upstream['summary'];
  const research = ctx.upstream['research_summary'];
  const input = [
    `Purpose / what to say: ${purpose}`,
    ctx.goal.slots.brandVoice ? `Tone: ${ctx.goal.slots.brandVoice}` : '',
    `Channel: ${channel} — keep it DM-length, no subject line.`,
    concept ? `Context to ground in: ${JSON.stringify(concept).slice(0, 1000)}`
      : summary ? `Summary to base the message on: ${JSON.stringify(summary).slice(0, 1000)}`
      : research ? `Research findings to base the message on: ${JSON.stringify(research).slice(0, 1200)}` : '',
    `Write the message entirely in this language: ${language}.`,
  ].filter(Boolean).join('\n');

  let usage: GeminiUsage | null = null;
  const raw = await call(DM_WRITER_PROMPT, input, (u) => { usage = u; });
  const o = (raw ?? {}) as { body?: unknown };
  const body = String(o.body ?? '').trim().slice(0, 4000);
  if (!body) throw new Error('dm_writer: the draft came back empty — try rephrasing what the message should say.');
  if (usage) await recordLlmUsage({ ownerId: ctx.ownerId, surface: 'dm', model: env.GEMINI_MODEL, usage, runId: ctx.runId });

  const groundedOn = concept ? 'content_concept' : summary ? 'summary' : research ? 'research_summary' : 'goal';
  const parsed = dmDraft.safeParse({ channel, to, body, groundedOn });
  if (!parsed.success) throw new Error(`dm_writer: malformed draft (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return {
    type: 'dm_draft',
    data: parsed.data,
    cost: usage ? costFromUsage(usage, env.GEMINI_MODEL) : estimateLlmCost(DM_WRITER_PROMPT + input, body),
  };
};

// dm_agent: send the reviewed draft via the messaging-adapter registry. Gated upstream
// (requiresApproval) so this only runs AFTER the user approved the draft — mirrors runEmailAgent.
export const runDmAgent = async (ctx: RunnerContext): Promise<RunnerOutput> => {
  const draft = ctx.upstream['dm_draft'] as { channel?: string; to?: string; body?: string } | undefined;
  const channel = draft?.channel;
  const to = draft?.to?.trim();
  const body = draft?.body?.trim();
  if (!channel || !isChannel(channel) || !to || !body) throw new Error('dm_agent: no reviewed draft to send.');

  // Idempotency / double-send guard: a re-entered or resumed run must send AT MOST ONCE — mirrors
  // CreditLedger's [runId,kind] debit guard, enforced by DmMessage.runId's DB unique constraint.
  const existing = await getDmMessageByRun(ctx.runId);
  if (existing) {
    logger.info('dm_agent_already_sent', { runId: ctx.runId, channel });
    const parsedExisting = dmResult.safeParse({ channel, to, status: existing.status, platformMessageId: existing.providerMessageId, error: existing.error });
    if (parsedExisting.success) return { type: 'dm_result', data: parsedExisting.data };
  }

  // Opt-in gate (HARD invariant, fail LOUD like the publisher kill-switch): never send to a contact
  // that hasn't opted in on THIS channel. Telegram = the lead /start'ed the bot; WhatsApp = consent +
  // an approved template; Zalo = a ZNS-eligible phone. Runs even in DRY-RUN so the check is exercised
  // on every send, not skipped in verification.
  const optIn = await getOptInState(ctx.ownerId, channel, to);
  if (optIn !== 'opted_in') {
    throw new Error(`dm_agent: refusing to send — contact has not opted in on ${channel} (state=${optIn}).`);
  }

  const contactId = await getOrCreateContactId(ctx.ownerId, channel, to);
  const result = await sendDm(channel, { ownerId: ctx.ownerId, to, body }, ctx.dmSendFn);
  if (!result.ok) throw new Error(`dm_agent: send failed (${result.error ?? 'unknown'})`);

  const status = result.dryRun ? 'dry_run' : 'sent';
  await recordDmMessage({ ownerId: ctx.ownerId, contactId, channel, runId: ctx.runId, status, providerMessageId: result.platformMessageId, body, error: null })
    .catch((e) => logger.warn('dm_message_log_failed', { runId: ctx.runId, error: String(e).slice(0, 160) }));

  logger.info('wf_dm_sent', { runId: ctx.runId, channel, status });
  const parsed = dmResult.safeParse({ channel, to, status, platformMessageId: result.platformMessageId, error: null });
  if (!parsed.success) throw new Error(`dm_agent: malformed result (${parsed.error.issues[0]?.message ?? 'invalid'})`);
  return { type: 'dm_result', data: parsed.data };
};
