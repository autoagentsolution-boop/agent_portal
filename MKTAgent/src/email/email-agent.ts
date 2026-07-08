// Email Agent (Atria v2 P2-2c) — drafts a personalised nurture email for a captured lead, grounded in
// the lead's context (name, the product they came in on, their message, score). The USER reviews +
// sends (human gate — no auto-blast; honors the no-burst rule). Sending itself is gmail-send.ts.
import { env } from '../config/env.ts';
import { callGeminiJson, type LlmJsonFn } from '../orchestration/master/llm-json.ts';
import { recordLlmUsage } from '../cost/llm-usage.ts';
import type { DecryptedLead } from '../db/repos/lead-repo.ts';

export interface EmailDraft { subject: string; body: string }

const SYSTEM_PROMPT = [
  "You are Atria's Email Agent. Write ONE short, warm, personal nurture email to a captured marketing",
  'lead — the goal is a genuine next step (reply, quick call, or a resource), NOT a hard sell. Plain',
  'text, no HTML. Keep it under ~120 words, one clear CTA, no spammy phrasing or ALL-CAPS. Address the',
  'person by first name if given. Ground it in the product they showed interest in and their message;',
  'invent no facts, promise nothing specific. Sign off warmly without a fake company signature block.',
  'Respond ONLY as JSON: {"subject":"<=80 chars","body":"plain-text email"}.',
].join(' ');

const buildInput = (lead: DecryptedLead, brand?: string | null): string =>
  [
    brand ? `Sender brand: ${brand}` : '',
    `Lead name: ${lead.name ?? '(unknown)'}`,
    `Product / interest: ${lead.sourceProduct ?? '(general)'}`,
    `Lead's message: ${lead.message ?? '(none)'}`,
    `Intent score (0-100): ${lead.score ?? '(unscored)'}`,
    '',
    'Write the nurture email.',
  ].filter(Boolean).join('\n');

const clampDraft = (raw: unknown): EmailDraft => {
  const o = (raw ?? {}) as { subject?: unknown; body?: unknown };
  const subject = String(o.subject ?? '').trim().slice(0, 120) || 'Following up';
  const body = String(o.body ?? '').trim().slice(0, 4000);
  return { subject, body };
};

// Draft a nurture email for a lead. LlmJsonFn injectable so verification runs DRY (no spend). Records
// usage under surface 'email'. `brand` is the sender's brand name (from the owner/campaign) for tone.
export const draftNurtureEmail = async (
  ownerId: string,
  lead: DecryptedLead,
  opts: { brand?: string | null; llm?: LlmJsonFn } = {},
): Promise<EmailDraft> => {
  const llm = opts.llm ?? callGeminiJson;
  let usage;
  const raw = await llm(SYSTEM_PROMPT, buildInput(lead, opts.brand), (u) => { usage = u; });
  if (usage) await recordLlmUsage({ ownerId, surface: 'email', model: env.GEMINI_MODEL, usage, refId: lead.id });
  return clampDraft(raw);
};
