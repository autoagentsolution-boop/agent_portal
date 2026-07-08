# P4 — Voice for Atria (SPEC ONLY — build deferred to v2 proper)

**Priority:** P2 · **Status:** spec · Per decision 3: design the flow + pick tech now; build in v2.

## Goal
Atria converses by VOICE — the user speaks, Atria replies in voice (not just text). Turn-taking,
barge-in tolerable, language follows the user (mirror rule already exists for text —
[[feedback_orchestrate_reply_language]]).

## Design axes to decide (this spec's output)
1. **Architecture:**
   - (A) **Pipeline**: browser Web Speech API (STT) → existing text master-agent → TTS out
     (Gemini/MiniMax TTS already used for video). Cheapest, reuses everything; higher latency,
     turn-based only.
   - (B) **Realtime API** (Gemini Live / OpenAI Realtime): streaming duplex, low latency, barge-in.
     Best UX; new dependency + cost + a separate session model.
   - Recommendation: ship (A) as v2's first voice (reuses the whole text brain + TTS), keep (B) as the
     "big" upgrade once voice is validated.
2. **Where it lives:** the Command Center Atria centre (P1) — a mic toggle on the conductor panel.
3. **Language/voice:** detect from speech; pick a TTS voice per language (Gemini TTS multi-lang exists).
4. **Cost/telemetry:** meter STT/TTS into `mkt_llm_usage` (new surfaces) like every other spend.
5. **Privacy:** mic permission UX; no audio stored beyond the turn unless the user opts in.

## Deliverable
A short design doc (this file → expand) + a tech decision (A vs B) + the integration points into P1's
Atria panel. NO implementation in v2-prep.

## Todo
- [ ] Pick architecture A vs B (recommend A first)
- [ ] Voice-in/out flow diagram + turn-taking + language handling
- [ ] Cost metering surfaces + privacy/permission UX
- [ ] Integration point spec into the Command-Center Atria panel (P1)

## Success criteria
- A clear, buildable voice spec the v2 UI team can implement without re-deciding architecture.

## Risk
- Realtime API (B) latency/cost/complexity — why A is the recommended first cut.
