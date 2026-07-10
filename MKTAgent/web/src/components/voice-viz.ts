// Voice-amplitude → Atria core reaction (P5.4 chunk 3). When a read-aloud TTS clip plays, we route
// its audio element through a shared Web Audio AnalyserNode and, each frame, publish the signal RMS
// to :root as `--voice-level` (0..1) plus a `data-atria-speaking` flag. The Command Center core CSS
// reads these so Atria's pulse/orb visibly RIDES the narration — it "speaks".
//
// Read-aloud plays a same-origin Blob URL (URL.createObjectURL of the /voice/tts bytes), so the
// analyser can read the samples (a cross-origin element would yield silence). One AudioContext is
// reused across clips (browsers cap contexts); createMediaElementSource routes the element THROUGH
// the graph, so we must also connect analyser→destination or the clip goes silent.
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let raf = 0;
let active = 0; // elements currently routed (0 or 1 in practice — one narration at a time)

function ensureCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78; // damp jitter → smooth "breathing" ride
  }
  return ctx;
}

function tick(): void {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
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

function stopLoop(): void {
  active = Math.max(0, active - 1);
  if (active > 0) return;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  document.documentElement.removeAttribute('data-atria-speaking');
  document.documentElement.style.setProperty('--voice-level', '0');
}

// Route one read-aloud audio element through the analyser. Safe to call once per element (a second
// createMediaElementSource on the same element throws — we swallow it so audio still plays).
export function attachVoiceAnalyser(audio: HTMLAudioElement): void {
  let c: AudioContext;
  try {
    c = ensureCtx();
  } catch {
    return; // no Web Audio → skip viz, audio plays normally
  }
  void c.resume(); // called from the click gesture → allowed
  try {
    const src = c.createMediaElementSource(audio);
    src.connect(analyser!);
    analyser!.connect(c.destination);
  } catch {
    return; // already routed / not allowed → leave audio untouched
  }
  const start = (): void => {
    active += 1;
    document.documentElement.setAttribute('data-atria-speaking', '');
    if (!raf) raf = requestAnimationFrame(tick);
  };
  audio.addEventListener('playing', start);
  audio.addEventListener('ended', stopLoop);
  audio.addEventListener('pause', stopLoop);
  if (!audio.paused) start();
}
