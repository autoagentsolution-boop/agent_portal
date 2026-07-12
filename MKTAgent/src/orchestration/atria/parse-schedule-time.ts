// Gemini natural-language time parser (generic-scheduler node, Phase 02). Turns "sáng mai" /
// "tomorrow morning" / "next Mon 9am" into ONE absolute future UTC instant + the IANA zone it resolved
// in, plus a human-readable confirm string. The parse is a PROPOSAL: Atria always reads the exact instant
// back and the user must confirm before anything is scheduled (the single mitigation covering BOTH parse
// ambiguity AND sender-vs-recipient timezone). Reuses callGeminiJson + the 'chat' usage ledger.
import { env } from '../../config/env.ts';
import { callGeminiJson } from '../master/llm-json.ts';
import { recordLlmUsage } from '../../cost/llm-usage.ts';
import type { GeminiUsage } from '../executor/node-cost.ts';

export interface ParsedSchedule {
  atUtc: string; // ISO 8601 UTC instant (validated future)
  timezone: string; // IANA zone the instant was resolved in
  humanConfirm: string; // one short sentence in the user's language stating the exact local time + tz
}

const SYSTEM = [
  'You convert a natural-language time expression into a single absolute FUTURE instant.',
  'Given the current UTC time and (maybe) the user\'s timezone, resolve the phrase to ONE concrete instant.',
  'Respond ONLY as strict JSON: {"atUtc":"<ISO 8601 UTC, e.g. 2026-07-13T01:00:00Z>","timezone":"<IANA zone>","humanConfirm":"<one short sentence, in the user\'s language, stating the exact local date+time + timezone, asking them to confirm>"}.',
  'The instant MUST be strictly in the future relative to the current UTC time. If the phrase is ambiguous, pick the NEAREST sensible future instant AND state that assumption in humanConfirm.',
  'Approximate parts of day when no clock time is given: morning≈08:00, afternoon≈14:00, evening≈19:00, night/tonight≈20:00 local.',
  'If no timezone is known, assume "Asia/Bangkok" and say so in humanConfirm so the user can correct it. The recipient may live in a different timezone than the sender — never silently assume they match.',
].join('\n');

// Returns null on any failure (no key / parse error / a past-or-invalid instant) so the caller asks the
// user to restate the time instead of parking an unconfirmed/bad schedule.
export async function parseScheduleTime(
  phrase: string,
  ownerId: string,
  senderTz?: string | null,
): Promise<ParsedSchedule | null> {
  if (!env.GEMINI_API_KEY) return null;
  const nowIso = new Date().toISOString();
  const input = `Current UTC time: ${nowIso}\nUser timezone: ${senderTz ?? 'unknown'}\nPhrase: ${phrase}`;
  let usage: GeminiUsage | null = null;
  try {
    const raw = await callGeminiJson(SYSTEM, input, (u) => { usage = u; });
    if (usage) void recordLlmUsage({ ownerId, surface: 'chat', model: env.GEMINI_MODEL, usage }).catch(() => {});
    const o = (raw ?? {}) as { atUtc?: unknown; timezone?: unknown; humanConfirm?: unknown };
    const atUtc = String(o.atUtc ?? '').trim();
    const at = new Date(atUtc);
    // Validate future (Phase 02 risk): a bad/past instant → null so Atria re-asks, never parks.
    if (!atUtc || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
    return {
      atUtc: at.toISOString(),
      timezone: String(o.timezone ?? '').trim() || 'Asia/Bangkok',
      humanConfirm: String(o.humanConfirm ?? '').trim() || `Schedule for ${at.toISOString()} — confirm?`,
    };
  } catch {
    return null;
  }
}
