# P4 — Voice for Atria (SPEC — build deferred to v2 proper)

**Priority:** P2 · **Status:** SPEC COMPLETE (2026-07-08) · Per decision 3: design + tech chosen now;
implementation is a v2-proper task. This doc is buildable as-is — the v2 UI team should not need to
re-decide architecture.

## Goal
Atria converses by VOICE: the user speaks, Atria replies in voice. Turn-based first (press/hold or
toggle mic), language mirrors the user (the text mirror rule already exists —
[[feedback_orchestrate_reply_language]]). Lives on the Command Center Atria centre (P1).

## DECISION — Architecture A (pipeline) first
Ship **A** as v2's first voice; keep **B** (realtime duplex) as the "big" upgrade once voice is validated.

| | A · Pipeline (CHOSEN first) | B · Realtime duplex |
|---|---|---|
| STT | Browser **Web Speech API** (free, on-device-ish) → server fallback later | Streaming STT in the realtime session |
| Brain | **Reuse `orchestration-chat.ts`** verbatim (the whole text master-agent) | New realtime session model (separate brain wiring) |
| TTS | **Reuse `src/video/tts.ts`** (Gemini `gemini-2.5-flash-preview-tts`, multi-lang voices) | Model-native streamed audio |
| Latency | Turn-based (~1–3s after speech end) | Low, barge-in, interruptible |
| Cost | STT free (browser) + TTS per-char (already metered pattern) | Higher; duplex audio billing |
| New deps | None server-side (browser STT + existing TTS) | Gemini Live / OpenAI Realtime API + session infra |
| Risk | Low — reuses the entire text brain + TTS | Latency/cost/complexity; why A goes first |

**Why A:** near-zero new backend — it wraps the EXISTING chat + EXISTING TTS with a browser mic and a
speaker. Validates the voice UX before paying realtime's complexity/cost. B is a clean later swap
because the brain (chat) and the surface (Atria centre) stay the same; only the transport changes.

## Flow (Architecture A — turn-based)
```
[mic toggle on Atria centre]
  └─ Web Speech API (SpeechRecognition, lang=auto/last) → interim + final transcript
       └─ on final transcript → POST the text to the EXISTING chat turn (orchestration-chat)
            └─ assistant text reply (already language-mirrored)
                 └─ POST /voice/tts { text, lang } → Gemini TTS → audio bytes (mp3/pcm)
                      └─ browser plays audio; mic auto-re-arms for the next turn
```
- **Turn-taking:** toggle or push-to-talk. While Atria's audio plays, mic is muted; a "stop speaking"
  (barge-in) button cancels playback + re-arms the mic. Full duplex barge-in is a B feature.
- **Language:** SpeechRecognition `lang` seeds from the user's last text language; the chat reply is
  already mirrored (text rule); TTS picks a voice per detected language (Gemini TTS multi-lang map —
  e.g. vi → a VN voice, en → an EN voice; table lives with the TTS voice config).
- **Streaming (nice-to-have):** sentence-chunk the reply → TTS each sentence as it arrives so audio
  starts before the full reply is written (hides latency). Optional for the first cut.

## Reuse map (what exists vs what's new)
- REUSE: `orchestration-chat.ts` (brain, unchanged), `src/video/tts.ts` (TTS, factor a `synthesize(text,
  {lang,voice})` helper out of the video-specific caller), the language-mirror rule, `mkt_llm_usage`.
- NEW (v2 build): (1) a thin `POST /voice/tts` route (text→audio; auth-scoped; streams/returns audio);
  (2) browser voice controller in the Atria panel (mic capture + SpeechRecognition + playback + turn
  state machine); (3) mic toggle UI on the Command Center Atria centre; (4) two usage surfaces.

## Cost / telemetry
- Meter TTS under a new `surface: 'tts'` via `recordMediaCost` (per-char/per-second USD, mirrors the
  video TTS metering already in place). STT is browser-side/free in A → no meter (note if a server STT
  fallback is added later → `surface: 'stt'`). `surface` is a free-form string → **no schema change**;
  Usage + Impact pages pick the new surfaces up automatically.

## Privacy / permission UX
- Explicit mic permission prompt on first toggle; a persistent "listening" indicator when the mic is
  live. No audio persisted beyond the turn (transcript is transient; only the resulting TEXT enters
  chat history, same as typing). An opt-in "save audio" is out of scope. Web Speech API sends audio to
  the browser's speech service (Chrome → Google) — disclose this in the mic tooltip.

## Integration point (into P1's Command Center)
- The Atria centre (`command-center-page.tsx` `.cc-core`, today `onClick → onLaunch(chat)`): add a mic
  toggle affabordance. Voice opens the SAME conductor chat (OrchestratePanel) with a voice controller
  attached — text and voice are one conversation, not two surfaces. The composer stays for typing;
  voice is an input/output mode on top.
- The turn loop drives the existing send path, so plan cards / suggestions / run launches all work
  identically whether the turn came from voice or text.

## Todo (for the v2 build, NOT now)
- [x] Pick architecture — **A (pipeline) first, B (realtime) later**
- [x] Voice-in/out flow + turn-taking + language handling — specified above
- [x] Cost surfaces (`tts`, later `stt`) + privacy/permission UX — specified
- [x] Integration point into the Command-Center Atria panel — specified
- [ ] BUILD (v2 proper): `/voice/tts` route + `synthesize()` helper + browser voice controller + mic UI

## Open questions (resolve at build time)
- Server STT fallback for browsers without Web Speech API (Safari/Firefox coverage) — Gemini/Whisper?
- Sentence-chunk streaming TTS in the first cut, or full-reply TTS for simplicity?
- Per-language TTS voice mapping table — reuse the video TTS voices or curate a conversational set?

## Success criteria
- A clear, buildable voice spec the v2 UI team can implement without re-deciding architecture. **MET.**
