// Voice-amplitude → Atria core reaction. Two directions share ONE render loop and one `--voice-level`
// CSS var (0..1), because output (Atria's TTS) and input (your mic while listening) are mutually
// exclusive in the voice-mode state machine:
//   • OUTPUT — a read-aloud/voice-mode TTS clip plays → route the audio element through an analyser →
//     publish RMS to :root as `--voice-level` + set `data-atria-speaking`. The core "speaks".
//   • INPUT  — while listening, route the mic MediaStream through a SEPARATE analyser (never connected
//     to destination, so it can't echo to the speakers) → same `--voice-level` + `data-atria-listening`.
//     The core visibly reacts to YOUR voice too — the full "alive" loop.
// One AudioContext is reused (browsers cap contexts). For output we must connect analyser→destination
// or the routed element goes silent; for input we must NOT, or the mic feeds back.
let ctx: AudioContext | null = null;
let outAnalyser: AnalyserNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let raf = 0;
let outActive = 0; // TTS elements currently routed (0 or 1 — one narration at a time)
let micActive = false;
let reader: AnalyserNode | null = null; // whichever analyser the loop currently samples

function ensureCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

function makeAnalyser(c: AudioContext): AnalyserNode {
  const a = c.createAnalyser();
  a.fftSize = 256;
  a.smoothingTimeConstant = 0.78; // damp jitter → smooth "breathing" ride
  return a;
}

function tick(): void {
  const a = reader;
  if (!a) return;
  const data = new Uint8Array(a.fftSize);
  a.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length); // ~0..0.4 for speech
  const level = Math.min(1, rms * 2.8); // scale speech RMS into a visible 0..1 range
  document.documentElement.style.setProperty('--voice-level', level.toFixed(3));
  raf = requestAnimationFrame(tick);
}

function startLoop(a: AnalyserNode): void {
  reader = a;
  if (!raf) raf = requestAnimationFrame(tick);
}

function maybeStopLoop(): void {
  if (outActive > 0 || micActive) return;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  reader = null;
  document.documentElement.style.setProperty('--voice-level', '0');
}

// ── OUTPUT: route one read-aloud/voice-mode audio element through the analyser ───────────────────────
// Safe to call once per element (a second createMediaElementSource on the same element throws — we
// swallow it so audio still plays).
export function attachVoiceAnalyser(audio: HTMLAudioElement): void {
  let c: AudioContext;
  try {
    c = ensureCtx();
  } catch {
    return; // no Web Audio → skip viz, audio plays normally
  }
  if (!outAnalyser) outAnalyser = makeAnalyser(c);
  void c.resume(); // called from a user gesture → allowed
  try {
    const src = c.createMediaElementSource(audio);
    src.connect(outAnalyser);
    outAnalyser.connect(c.destination);
  } catch {
    return; // already routed / not allowed → leave audio untouched
  }
  const start = (): void => {
    outActive += 1;
    document.documentElement.setAttribute('data-atria-speaking', '');
    startLoop(outAnalyser!);
  };
  const stop = (): void => {
    outActive = Math.max(0, outActive - 1);
    if (outActive === 0) document.documentElement.removeAttribute('data-atria-speaking');
    // Mic may still be active (barge-in); only give the loop back if nothing is driving it.
    if (micActive) startLoop(micAnalyser!);
    else maybeStopLoop();
  };
  audio.addEventListener('playing', start);
  audio.addEventListener('ended', stop);
  audio.addEventListener('pause', stop);
  if (!audio.paused) start();
}

// ── INPUT: route the live mic stream through a non-destination analyser while listening ──────────────
export function attachMicStream(stream: MediaStream): void {
  let c: AudioContext;
  try {
    c = ensureCtx();
  } catch {
    return;
  }
  void c.resume();
  try {
    if (!micAnalyser) micAnalyser = makeAnalyser(c);
    micSource?.disconnect();
    micSource = c.createMediaStreamSource(stream);
    micSource.connect(micAnalyser); // deliberately NOT connected to destination (no echo)
  } catch {
    return;
  }
  micActive = true;
  document.documentElement.setAttribute('data-atria-listening', '');
  startLoop(micAnalyser);
}

export function detachMicStream(): void {
  micActive = false;
  document.documentElement.removeAttribute('data-atria-listening');
  try { micSource?.disconnect(); } catch { /* noop */ }
  micSource = null;
  if (outActive > 0) startLoop(outAnalyser!);
  else maybeStopLoop();
}
