// Canonical TTS playback — the ONE owner of "Atria speaking". Both the read-aloud button (click) and
// voice mode (auto) call speak() so a single module-level `currentAudio` guarantees only one narration
// at a time and barge-in works uniformly (a new speak or stopSpeaking() pauses the prior clip). Fetches
// audio/wav from POST /voice/tts, plays a same-origin Blob URL, and routes it through voice-viz so the
// core rides the amplitude. Retries a one-shot 502 (Gemini TTS flakes intermittently); never retries a
// 429 (server throttle) — that would hammer paid synthesis.
import { attachVoiceAnalyser } from '../components/voice-viz.ts';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

async function fetchTts(text: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/voice/tts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) return URL.createObjectURL(await res.blob());
    // Retry ONLY a transient 502 once; a 429 (throttle) or 4xx is not worth re-hitting.
    if (res.status === 502 && attempt < 1) { await delay(500); continue; }
    throw new Error(`tts_${res.status}`);
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Stop whatever is currently narrating (barge-in / user pressed stop / a new speak starts).
export function stopSpeaking(): void {
  currentAudio?.pause();
}

export function isSpeaking(): boolean {
  return Boolean(currentAudio && !currentAudio.paused);
}

export interface SpeakCallbacks {
  onStart?: () => void;
  // Fires on natural end OR when interrupted (pause). `interrupted` lets the caller skip the
  // continuous-loop restart when the user barged in vs. when Atria finished a turn.
  onEnd?: (interrupted: boolean) => void;
}

export interface SpeakHandle {
  readonly done: Promise<void>;
  stop(): void;
}

// Fetch + play one narration. Resolves the returned handle once playback has actually started (so the
// caller can transition UI to "speaking"); `handle.done` resolves when the clip ends or is interrupted.
export async function speak(text: string, cb: SpeakCallbacks = {}): Promise<SpeakHandle> {
  stopSpeaking(); // single-narration guard + barge-in

  const url = await fetchTts(text);
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = url;

  const audio = new Audio(url);
  currentAudio = audio;

  let ended = false;
  let naturalEnd = false;
  const done = new Promise<void>((resolve) => {
    const finish = () => {
      if (ended) return;
      ended = true;
      if (currentAudio === audio) {
        currentAudio = null;
        if (currentUrl === url) { URL.revokeObjectURL(url); currentUrl = null; }
      }
      cb.onEnd?.(!naturalEnd);
      resolve();
    };
    audio.addEventListener('ended', () => { naturalEnd = true; finish(); });
    audio.addEventListener('pause', finish); // barge-in / stop / a newer speak paused us
  });

  audio.addEventListener('playing', () => cb.onStart?.());
  await audio.play(); // play a clean element first (best autoplay-policy outcome)
  attachVoiceAnalyser(audio); // route through Web Audio only once actually playing

  return { done, stop: () => audio.pause() };
}
