// NurtureDecision — the nurture brain's verdict for ONE inbound lead reply (Phase 03). The brain never
// sends; it only ever returns one of these actions, which the driver (nurture-runner.ts) turns into a
// state transition or an approval-parked draft. Zod is the single source of truth so a malformed model
// tool-call can never masquerade as a valid decision.
import { z } from 'zod';

// Reply-intent taxonomy (plan §Requirements). 'unclear' is the deliberate escape hatch for anything the
// model can't confidently place — it, like low confidence, is fail-closed to `escalate` (never drafted).
export const REPLY_INTENTS = ['interested', 'question', 'objection', 'not_now', 'booking', 'opt_out', 'unclear'] as const;
export const replyIntent = z.enum(REPLY_INTENTS);
export type ReplyIntent = z.infer<typeof replyIntent>;

// The only five things a decision can DO. draft_reply is the sole action that produces outbound content
// (still human-gated downstream); the rest are pure state transitions or a human hand-off.
export const NURTURE_ACTIONS = ['draft_reply', 'pause', 'mark_converted', 'mark_opted_out', 'escalate'] as const;
export const nurtureAction = z.enum(NURTURE_ACTIONS);
export type NurtureAction = z.infer<typeof nurtureAction>;

export const nurtureDraft = z.object({
  subject: z.string().max(200),
  body: z.string().max(4000),
});
export type NurtureDraft = z.infer<typeof nurtureDraft>;

export const nurtureDecision = z.object({
  action: nurtureAction,
  // The classification that led here — null only when a decision was forced without ever classifying
  // (e.g. a hard runtime failure defaulting to escalate).
  intent: replyIntent.nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  // Present iff action === 'draft_reply'.
  draft: nurtureDraft.nullable().default(null),
  // Audit / human-hand-off note. Required in spirit for 'escalate'; optional elsewhere.
  reason: z.string().max(500).nullable().default(null),
});
export type NurtureDecision = z.infer<typeof nurtureDecision>;

// Fail-closed default — used whenever the brain cannot safely produce a real decision (no API key,
// runtime error, deadline, malformed tool args). NEVER a draft.
export const escalateDecision = (reason: string, intent: ReplyIntent | null = null, confidence = 0): NurtureDecision =>
  nurtureDecision.parse({ action: 'escalate', intent, confidence, draft: null, reason });
