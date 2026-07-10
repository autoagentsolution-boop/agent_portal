# Voice Mode — hands-free voice conversation with Atria

Branch `pivot/video-content-farm` · 2026-07-10 · standalone plan (requested).
Goal: talk to Atria like Claude/ChatGPT voice mode — **speak a command → Atria hears it, thinks,
and replies in voice**, with the neural core reacting to BOTH your voice (input) and Atria's (output).
Today's state = click-to-confirm read-aloud only ([[project_demo_bigplan_260710]] "Conversational
read-aloud"); this plan adds the two missing halves: **mic STT input** + **auto-TTS output** + the
**continuous conversation loop**.

## What already exists (reuse — don't rebuild)
- **TTS out:** `POST /voice/tts` (Gemini `gemini-2.5-flash-preview-tts`), `read-aloud-button.tsx`,
  module-level single-audio guard. ⚠ intermittently 502s (add retry, Phase 4).
- **Core reaction:** `voice-viz.ts` (Web Audio AnalyserNode → `:root --voice-level` + `data-atria-speaking`);
  core glow/orb ride the amplitude. Reuse for OUTPUT; extend for INPUT (mic amplitude).
- **Intent + auto-read seam:** `read-intent.ts`, OrchestratePanel `applyRun(data, offerRead)`.
- **Chat send:** OrchestratePanel `start(text)` (createRun → reply). Composer `.composer-box`.

## Key decisions (locked / recommended)
| Decision | Choice | Why |
|---|---|---|
| STT engine | **Web Speech API** (`webkitSpeechRecognition`) for MVP | Browser-native, FREE, no backend, vi-VN+en-US. ⚠ Chrome/Edge only (Safari partial, Firefox off) → fallback to typing. Server STT (Gemini/Whisper) = upgrade path if accuracy/cross-browser needed. |
| TTS out | existing `/voice/tts` | already built + core-reactive |
| Interaction | **push-to-talk first** (click mic → speak → auto-end on silence), then **continuous** (auto-listen after Atria speaks) in Phase 3 | KISS; continuous is the "wow" but needs barge-in + VAD tuning |
| Autoplay | mic-click is the user gesture → auto-TTS allowed | solves the autoplay gate cleanly |
| Language | mirror app/user language (vi/en); set `recognition.lang` | VN accuracy on Web Speech is decent for common speech |
| Barge-in | user starts speaking → pause Atria's TTS | natural conversation |

## Phases
- **P1 — STT input (push-to-talk).** `use-speech-recognition.ts` hook (start/stop, interim + final
  transcript, lang, errors, `supported`). Mic button in the composer; speak → live interim text in the
  input → on final, auto-send via `start()`. Unsupported browser → hide mic, keep typing. [phase-01]
- **P2 — Auto-TTS output + voice-mode toggle.** A "🎙 Voice" toggle (composer/CC). When ON: Atria's
  reply auto-reads (reuse read-aloud/voice-viz, no click) + core reacts. Barge-in: new mic-start pauses
  current TTS. [phase-02]
- **P3 — Continuous conversation loop.** State machine idle→listening→thinking→speaking→listening.
  After Atria finishes speaking, auto-restart listening (VAD/silence-end). Stop button + Esc to exit.
  Core shows the live state (listening=input-amplitude, thinking=is-conducting, speaking=output). [phase-03]
- **P4 — Polish + robustness.** Core reacts to INPUT amplitude while listening (mirror output, full
  "alive" loop). `/voice/tts` one-shot 502 retry. Mic-permission + error UX, unsupported-browser banner,
  language auto-detect, privacy note (Web Speech sends audio to Google). [phase-04]

## Architecture (data flow)
```
mic ─▶ SpeechRecognition ─▶ interim text (composer) ─▶ final ─▶ start(text) ─▶ createRun
                                                                                   │
core ◀─ voice-viz(--voice-level) ◀─ AnalyserNode ◀─ TTS audio ◀─ /voice/tts ◀─ reply
   ▲ (listening: mic-amplitude → same --voice-level path)         (voice-mode: auto)
```
- New: `web/src/hooks/use-speech-recognition.ts`, a small `voice-mode` state (context or lifted in
  OrchestratePanel/App), mic button + state indicator in composer.
- Reuse/extend: `voice-viz.ts` (add `attachMicAnalyser(stream)` for input), `read-aloud-button` logic
  (extract an imperative `speak(text)` so voice mode can auto-trigger without a button), OrchestratePanel
  auto-read when voice mode on.

## Risks
- **Browser support:** Web Speech API = Chrome/Edge only. Firefox/Safari → typing fallback (must degrade
  cleanly, not crash). Flag clearly.
- **VN STT accuracy** variable; short commands OK, long dictation shakier. Server STT upgrade path noted.
- **Barge-in / echo:** TTS playing while mic listens can feed back → mute mic during TTS, or require
  push-to-talk in P1/P2 (continuous echo handling is P3).
- **TTS 502 flakiness** (existing) — retry in P4 so a voice turn doesn't silently drop.
- **Privacy:** Web Speech streams audio to Google — note in UI + docs.

## Recommended order & scope
P1 (STT push-to-talk — immediately useful) → P2 (auto-TTS + toggle = the round-trip) → P3 (continuous,
the "wow") → P4 (polish). P1+P2 = a usable voice round-trip; ship + verify each. Verify via agent-browser
(note: headless mic is hard — verify the hook wiring + a manual mic pass; TTS/core reuse already proven).

## Success criteria
- Click mic, say "làm video ngắn về học từ vựng cho trẻ em trên facebook" → transcript appears → auto-sent
  → Atria plans (1 round, per the clarification fix) → reply auto-reads → core pulses. Hands-free after
  the initial mic click. Degrades to typing on unsupported browsers.
