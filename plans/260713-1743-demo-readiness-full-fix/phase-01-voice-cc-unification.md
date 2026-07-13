# P1 — Voice + Chat One Button, JARVIS Core Central

**Priority:** HIGH (most visible demo issue) · **Status:** ✅ DONE (FE, typecheck clean; browser check = P6) · **Layer:** FE only.

## Done (2026-07-13) — contained bridge, NOT a full state hoist
Key realization: the core already glows to voice via GLOBAL root attrs (`data-atria-speaking`/`-listening` set by voice-viz), so keeping it central is mostly CSS + the reactivity follows for free. So instead of the risky full `useVoiceMode` hoist (the speech machine is bidirectionally coupled to the panel's send fn), the panel STAYS the voice owner and:
- `OrchestratePanel` → `forwardRef` exposing `OrchestrateHandle { toggleVoice, stopVoice }` + `onVoiceChange({mode,state})` reported up; unmount stops STT/TTS. Removed the redundant composer 🎙 toggle (kept push-to-talk 🎤 + status line).
- `App` holds `voicePanelRef` + mirrored `voiceUi` (stable `useCallback` guard against churn); `closeCcChat` stops voice; passes `voice={{mode,state,onToggle}}` to CC.
- CC core = the ONE persistent two-way control in chat mode: `coreClick` → `voice.onToggle()`; core-sub shows Listening/Thinking/Speaking/Tap-to-talk; `aria-pressed`.
- CSS `.is-chat`: core stays large + central (`clamp(190px,27vh,300px)`, scale 1 — was 132px/0.82); hover + `is-voice-on` affordance.
Meets all 3 criteria (one persistent two-way control · core large+central+reactive · single source of truth) with a small blast radius.

## Root cause (confirmed, not a redirect)
App has NO router — nav is local `page` state in `App.tsx`. Clicking the CC mic does NOT navigate; `launchVoice` (`App.tsx:98`) sets `ccChatOpen=true`+`orchestrateAutoVoice=true`, staying on `command-center`. What looks like "redirect to a chat page" is `.command-center.is-chat` (`styles.css:377-385`) shrinking the JARVIS core to **132px** + hiding the constellation while the embedded `OrchestratePanel` chat takes the surface. Single-button voice+chat is ~90% built; problems: (1) layout demotes the core, (2) mic is one-way + fragmented across 3 controls.

## Requirements
1. ONE persistent control on the CC that TOGGLES voice+chat on/off (two-way). Currently `cc-mic` (`command-center-page.tsx:290-292`) lives inside the `!chatActive` block → vanishes once active, can't turn off.
2. When voice/chat active, the **JARVIS core stays large + central** and voice-reactive (listening=teal, speaking=violet glow already exist at `styles.css:1063-1094`); chat transcript sits alongside/below, not replacing the core.
3. ONE source of truth for voice state shared by the CC control and the chat panel (today `voiceMode` is private inside `OrchestratePanel`, the CC can't see/toggle it → the 3 controls desync).

## Architecture
Hoist the voice state machine out of `OrchestratePanel` into a shared hook `useVoiceMode` (new `web/src/hooks/use-voice-mode.ts`) owning: `voiceMode` (idle|listening|thinking|speaking), `toggleVoiceMode`, `micClick`, `speakReply`, wiring `useSpeechRecognition` + `tts-player` + `voice-viz`. Both the CC core button and the panel consume the same hook instance (lift to `App.tsx` and pass down, OR a small context `VoiceProvider`).
- CC core button (`command-center-page.tsx:159 coreClick`) + a persistent mic become the single toggle → call `voice.toggle()`.
- Remove/collapse the 3 separate controls (`OrchestratePanel` composer-voice 344-351, composer-mic 352-359, voice-status 320-329) into reads of the shared hook.
- Redesign `.command-center.is-chat` (`styles.css:377-385`): keep `.cc-network`/`.cc-core` at a large central size (e.g. min 320–420px, not 132px); place `.cc-chat-embed` in a side/lower column. Core voice-reaction CSS (1063-1094) unchanged — it already scales by `--voice-level`.

## Related code files
**Read:** `web/src/App.tsx` (98 launchVoice, 52/111 ccChatOpen/Active, 43 orchestrateAutoVoice, 112/318 closeCcChat, 294-312 orchestratePanelEl, 333-351 CC mount+chatSlot), `web/src/components/command-center-page.tsx` (87, 159 coreClick, 162-174 core, 290-292 mic), `web/src/components/OrchestratePanel.tsx` (71, 87-88 voiceMode, 92-138 voice machine+autoVoice, 320-359 controls), `web/src/styles.css` (377-385 is-chat, 1063-1094 core react), `web/src/hooks/use-speech-recognition.ts` (55), `web/src/lib/tts-player.ts`, `web/src/components/voice-viz.ts`, `web/src/lib/read-intent.ts`.
**Create:** `web/src/hooks/use-voice-mode.ts` (shared state machine) [+ optional `web/src/voice-context.tsx`].
**Modify:** `App.tsx` (own/provide voice state; make launchVoice a toggle), `command-center-page.tsx` (persistent two-way mic + keep core prominent when chatActive), `OrchestratePanel.tsx` (consume shared hook, drop private voiceMode + duplicate controls), `styles.css` (`.is-chat` layout keeps core central).

## Implementation steps
1. Extract `useVoiceMode` from OrchestratePanel:83-148 (voiceMode machine, useSpeechRecognition, speakReply, toggleVoiceMode, micClick). Keep `autoVoice` semantics.
2. Lift the hook to `App.tsx` (or a `VoiceProvider`); pass `voice` into both CC page and OrchestratePanel.
3. Make the CC mic persistent + two-way: move it out of the `!chatActive` gate; icon reflects `voice.mode` (idle/listening/speaking); onClick → `voice.toggle()`. `launchVoice` becomes `voice.toggle()` + open chat.
4. Restyle `.command-center.is-chat`: core stays large central, chat in a secondary column (responsive: stack on narrow).
5. Remove the 3 duplicate controls in OrchestratePanel; keep one status line reading shared state.
6. Ensure "Command Center" nav (`App.tsx:318`) closing chat also calls `voice.stop()`.

## Todo
- [ ] `useVoiceMode` shared hook (extract from OrchestratePanel)
- [ ] Lift/provide to App; wire CC + panel to same instance
- [ ] Persistent two-way CC mic reflecting state
- [ ] `.is-chat` layout keeps JARVIS core central
- [ ] Remove duplicate voice controls
- [ ] nav-away stops voice
- [ ] UI-flow verify (P6): click mic → core stays big + glows, talk → transcribes + replies + reads aloud → click again → voice off, chat remains

## Success criteria
Single click starts voice+chat with the JARVIS core large and reactive (no shrink); speaking to Atria transcribes → sends → replies → reads aloud; clicking the same control stops voice (chat stays); no duplicate/desynced mic buttons. Verified in the real browser (P6), not just unit.

## Risk
- Hoisting state can cause re-render churn → memoize hook returns (see `feedback_react_callback_prop_stable`).
- `webkitSpeechRecognition` is Chrome-only (`VOICE_SUPPORTED`) — keep the feature-gate.
- Barge-in: keep single-narration guard in `tts-player`.
