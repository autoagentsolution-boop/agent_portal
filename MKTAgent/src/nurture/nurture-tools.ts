// Nurture brain tools (Phase 03) — the closed tool menu nurture-brain.ts's reasoning loop selects
// from, plus the dispatcher. Mirrors orchestration/atria/atria-tools.ts's shape (declarations +
// dispatchTool over a per-turn ToolContext), scoped down to exactly what one reply decision needs:
// classify, then finalize with EXACTLY ONE of draft_reply / set_state / escalate. None of these tools
// perform an external action themselves (no send, no DB write) — dispatchTool only records the model's
// call onto `ctx`; nurture-brain.ts (the loop) and nurture-runner.ts (the driver) turn the finished
// NurtureDecision into real state changes / a parked run. That keeps "the brain never sends" mechanical,
// not just a prompt promise.
import { REPLY_INTENTS, type ReplyIntent, type NurtureDecision } from './decision-schema.ts';

export interface NurtureToolContext {
  ownerId: string;
  // The classification recorded by classify_reply this turn — null until the model calls it. The three
  // terminal tools read it to fill `intent`/`confidence` on the final decision.
  classification: { intent: ReplyIntent; confidence: number } | null;
  // Set by whichever terminal tool fires FIRST; a second terminal call this turn is a no-op (defensive —
  // the loop stops as soon as this is non-null, so in practice only one ever lands).
  decision: NurtureDecision | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asIntent = (v: unknown): ReplyIntent => (REPLY_INTENTS as readonly string[]).includes(String(v)) ? (v as ReplyIntent) : 'unclear';
const clampConfidence = (v: unknown): number => Math.max(0, Math.min(1, Number(v) || 0));

export const TOOL_DECLARATIONS = [
  {
    name: 'classify_reply',
    description:
      'ALWAYS call this FIRST, before any other tool. Classify the lead\'s latest reply into exactly one intent and state your confidence.',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: [...REPLY_INTENTS], description: 'interested | question | objection | not_now | booking | opt_out | unclear' },
        confidence: { type: 'number', description: '0.0-1.0 — how sure you are of this classification.' },
      },
      required: ['intent', 'confidence'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Finalize with a short, warm, grounded in-thread reply email. Use for interested / question / booking / an objection you can genuinely address. NEVER state a price, discount, availability date, or any commitment not explicitly present in the PRODUCT KNOWLEDGE given to you — if the reply asks for something you cannot verify from it, call escalate instead. Call classify_reply first.',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Reply subject line, <=120 chars.' },
        body: { type: 'string', description: 'Plain-text reply body. Short, human, one clear next step.' },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'set_state',
    description:
      'Finalize with a pure state change and NO reply email. Use status="paused" for not_now (stop the automated sequence, nothing needs saying). Use status="opted_out" for an explicit unsubscribe/stop/not-interested-permanently reply. Call classify_reply first.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['paused', 'opted_out', 'converted'] } },
      required: ['status'],
    },
  },
  {
    name: 'escalate',
    description:
      'Finalize by handing this reply to a human — no draft, no state change. Use whenever you are unsure, the intent is unclear, or the reply needs a commitment (pricing, custom terms, a promise) you cannot verify from the PRODUCT KNOWLEDGE given to you. When genuinely unsure, ALWAYS prefer this over guessing.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'One short sentence: why this needs a human.' } },
      required: ['reason'],
    },
  },
] as const;

const STATUS_TO_ACTION: Record<string, NurtureDecision['action']> = {
  paused: 'pause',
  opted_out: 'mark_opted_out',
  converted: 'mark_converted',
};

// Dispatch one tool call. Never throws — an unknown/malformed call degrades to a note the model reads
// next round rather than breaking the loop (mirrors atria-tools.dispatchTool's contract).
export function dispatchNurtureTool(name: string, args: Record<string, unknown>, ctx: NurtureToolContext): unknown {
  switch (name) {
    case 'classify_reply': {
      ctx.classification = { intent: asIntent(args.intent), confidence: clampConfidence(args.confidence) };
      return { recorded: true, note: 'Now call exactly one of draft_reply / set_state / escalate to finalize.' };
    }
    case 'draft_reply': {
      if (ctx.decision) return { error: 'already_finalized' };
      const subject = str(args.subject).trim().slice(0, 200) || 'Following up';
      const body = str(args.body).trim().slice(0, 4000);
      if (!body) return { error: 'empty_body', note: 'A draft needs a non-empty body — try again or escalate.' };
      ctx.decision = {
        action: 'draft_reply',
        intent: ctx.classification?.intent ?? null,
        confidence: ctx.classification?.confidence ?? 0.5,
        draft: { subject, body },
        reason: null,
      };
      return { finalized: true };
    }
    case 'set_state': {
      if (ctx.decision) return { error: 'already_finalized' };
      const action = STATUS_TO_ACTION[str(args.status)];
      if (!action) return { error: 'unknown_status', note: 'status must be paused | opted_out | converted.' };
      ctx.decision = {
        action,
        intent: ctx.classification?.intent ?? null,
        confidence: ctx.classification?.confidence ?? 0.5,
        draft: null,
        reason: null,
      };
      return { finalized: true };
    }
    case 'escalate': {
      if (ctx.decision) return { error: 'already_finalized' };
      ctx.decision = {
        action: 'escalate',
        intent: ctx.classification?.intent ?? null,
        confidence: ctx.classification?.confidence ?? 0,
        draft: null,
        reason: str(args.reason).trim().slice(0, 500) || 'unspecified',
      };
      return { finalized: true };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
