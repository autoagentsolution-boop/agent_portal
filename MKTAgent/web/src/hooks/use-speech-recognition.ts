// Speech-to-text via the browser-native Web Speech API (webkitSpeechRecognition). FREE, no backend,
// decent vi-VN + en-US accuracy for short commands. Chrome/Edge only — Firefox/Safari lack it, so
// `supported` gates the whole voice UI (degrade to typing, never crash). Push-to-talk shape:
// continuous=false + interimResults=true means it streams interim text as you speak and auto-ends on
// a natural silence, firing onFinal with the transcript. While listening we also open a getUserMedia
// stream purely for the core amplitude viz (SpeechRecognition itself exposes no audio samples).
import { useCallback, useEffect, useRef, useState } from 'react';
import { attachMicStream, detachMicStream } from '../components/voice-viz.ts';

// Minimal DOM typings — TS lib.dom doesn't ship SpeechRecognition reliably.
interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionResult { readonly length: number; isFinal: boolean; [i: number]: SpeechRecognitionAlternative }
interface SpeechRecognitionResultList { readonly length: number; [i: number]: SpeechRecognitionResult }
interface SpeechRecognitionEventLike { resultIndex: number; results: SpeechRecognitionResultList }
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  lang?: string; // BCP-47, e.g. 'vi-VN' | 'en-US'
  onFinal?: (text: string) => void;
  onInterim?: (text: string) => void;
  visualize?: boolean; // open a mic stream for the core amplitude viz while listening
}

export interface SpeechRecognitionState {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition(opts: UseSpeechRecognitionOptions = {}): SpeechRecognitionState {
  const supported = useRef<boolean>(Boolean(getCtor())).current;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const finalRef = useRef('');
  // Keep latest callbacks/opts in a ref so recognition handlers never go stale without re-creating it.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stopViz = useCallback(() => {
    detachMicStream();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const startViz = useCallback(async () => {
    if (!optsRef.current.visualize || micStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Recognition may have already ended by the time permission resolves — bail if so.
      if (!recRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      micStreamRef.current = stream;
      attachMicStream(stream);
    } catch { /* viz is best-effort; STT still works without it */ }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!supported || recRef.current) return;
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    // Follow the caller, else the BROWSER's own locale. Hardcoding 'vi-VN' made every non-Vietnamese
    // user's speech transcribe against a Vietnamese acoustic model — their words came back as garbage.
    rec.lang = optsRef.current.lang ?? navigator.language ?? 'en-US';
    rec.continuous = false; // push-to-talk: auto-end on silence
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    finalRef.current = '';
    setError(null);
    setInterim('');

    rec.onstart = () => { setListening(true); void startViz(); };
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) finalRef.current += txt;
        else interimText += txt;
      }
      const live = (finalRef.current + interimText).trim();
      setInterim(live);
      optsRef.current.onInterim?.(live);
    };
    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' are benign (user said nothing / we stopped it) — don't surface as errors.
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(e.error);
    };
    rec.onend = () => {
      setListening(false);
      stopViz();
      recRef.current = null;
      const text = finalRef.current.trim();
      setInterim('');
      if (text) optsRef.current.onFinal?.(text);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // start() throws if called while already started — reset defensively.
      recRef.current = null;
      setListening(false);
    }
  }, [supported, startViz, stopViz]);

  // Clean up on unmount: abort recognition + release the mic stream.
  useEffect(() => () => {
    recRef.current?.abort();
    recRef.current = null;
    stopViz();
  }, [stopViz]);

  return { supported, listening, interim, error, start, stop };
}
