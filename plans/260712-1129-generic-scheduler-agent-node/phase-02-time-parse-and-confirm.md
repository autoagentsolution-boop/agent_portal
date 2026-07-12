# Phase 02 — Gemini time-parse + Atria confirm

**Priority:** P0 · **Status:** ⬜ Not started · **Depends on:** 01

## Overview
Turn "sáng mai" / "tomorrow morning" / "next Mon 9am" into a confirmed absolute UTC instant. Gemini
parses; Atria ALWAYS confirms the exact instant + timezone with the user before it becomes bindable
(the recipient may live in a different tz than the sender — never assume).

## Key insight
Confirmation is the single mitigation that covers BOTH parse ambiguity and timezone. So the parse
output is a PROPOSAL until the user says yes; only then `schedule.confirmed = true`.

## Related code files
- Create: `src/orchestration/atria/parse-schedule-time.ts` — Gemini call: (phrase, nowISO, senderTz)
  → `{ atUtc, timezone, humanConfirm }`. Reuse `callGeminiJson` + `recordLlmUsage` (surface `chat`).
- Modify: `src/orchestration/atria/atria-tools.ts` — new tool `set_schedule(when_phrase)` that calls
  the parser, stores the PROPOSAL on ctx, and returns the human-confirm string for Atria to echo.
- Modify: `src/orchestration/prompts/atria-brain-prompt.ts` — instruct: when the user asks to schedule
  an action, call `set_schedule`, then CONFIRM the exact instant+tz in the user's language; only after
  an explicit yes do you `propose_workflow` (schedule now confirmed). Clarify sender-vs-recipient tz.
- Modify: `src/orchestration/atria/atria-brain.ts` + router — thread `schedule` proposal→confirmed
  into the goal passed to `propose_workflow`.

## Implementation steps
1. Parser prompt: return strict JSON `{ atUtc: ISO8601, timezone: IANA, humanConfirm: string }`;
   given ambiguity, pick the nearest sensible instant AND state the assumption in `humanConfirm`.
2. `set_schedule` tool: store `{ phrase, at: atUtc, timezone, confirmed: false }` on ctx; DO NOT plan
   yet. Return `humanConfirm` so Atria voices it.
3. On user yes → next `propose_workflow` merges `schedule.confirmed = true` into the goal.
4. Prompt: forbid claiming anything is scheduled until confirmed + parked.

## Todo
- [ ] `parse-schedule-time.ts` (Gemini JSON, billed)
- [ ] `set_schedule` tool + declaration
- [ ] Brain prompt: parse → confirm (tz explicit) → propose only after yes
- [ ] Goal carries confirmed schedule into propose_workflow
- [ ] Typecheck green

## Success criteria
- "send tomorrow 8am to X" → Atria replies with a concrete instant+tz and asks to confirm; a bare
  "ok" flips `confirmed=true`; the proposed goal carries the ISO instant.

## Risks
- Gemini returns a bad/past instant → validate `atUtc > now`; if invalid, Atria re-asks instead of parking.
- Non-deterministic parse → the confirm step is the backstop; never park an unconfirmed time.
