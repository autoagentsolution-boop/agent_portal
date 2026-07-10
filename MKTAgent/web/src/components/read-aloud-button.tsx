// Read-aloud (P3 V2) — a speaker button that plays TTS for a chunk of text (an Atria reply or the
// Impact headline). Fetches audio/wav bytes from POST /voice/tts and plays a Blob URL. A module-level
// `currentAudio` guarantees only ONE narration plays at a time: starting a new one pauses the prior.
// Server-side the WAV is cached by text hash, so a repeat read is instant + free.
import { useEffect, useRef, useState } from 'react';
import { attachVoiceAnalyser } from './voice-viz.ts';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

// The single audio element allowed to play across all buttons. Pausing it fires each button's
// `onpause`, which resets that button to idle — so state stays consistent without a shared store.
let currentAudio: HTMLAudioElement | null = null;

async function fetchTts(text: string): Promise<string> {
  const res = await fetch(`${BASE}/voice/tts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`tts_${res.status}`);
  return URL.createObjectURL(await res.blob());
}

type Status = 'idle' | 'loading' | 'playing';

interface Props {
  text: string;
  title?: string;
  className?: string;
  // When set, the button renders as a prominent labeled CTA (icon + this text) instead of an
  // icon-only speaker — used for the intent-detected "read the result aloud" confirm on a reply.
  label?: string;
}

export function ReadAloudButton({ text, title = 'Đọc to', className = '', label }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // Synchronous guard: state updates are async, so two fast clicks both see status==='idle' and each
  // fire a fetch (orphaning the first audio). A ref blocks the second click immediately.
  const busyRef = useRef(false);

  // Free the blob URL + detach the shared handle on unmount so a scrolled-away bubble can't keep audio.
  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (currentAudio && currentAudio === audioRef.current) currentAudio = null;
  }, []);

  const play = async () => {
    if (status === 'playing') { audioRef.current?.pause(); return; } // toggle off
    if (busyRef.current || status === 'loading') return; // in-flight → ignore repeat clicks
    if (!text.trim()) return;
    if (currentAudio && currentAudio !== audioRef.current) currentAudio.pause(); // stop any other narration
    busyRef.current = true;
    setStatus('loading');
    try {
      const url = await fetchTts(text);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      currentAudio = audio;
      audio.onended = () => setStatus('idle');
      audio.onpause = () => setStatus((s) => (s === 'playing' ? 'idle' : s));
      await audio.play(); // play a clean element first (best autoplay-policy outcome)
      attachVoiceAnalyser(audio); // only once it's actually playing: route through Web Audio so the core rides the narration
      setStatus('playing');
    } catch {
      setStatus('idle');
    } finally {
      busyRef.current = false;
    }
  };

  const icon = status === 'loading' ? '…' : status === 'playing' ? '⏸' : '🔊';
  const shownLabel = label
    ? status === 'loading' ? 'Đang chuẩn bị…' : status === 'playing' ? 'Đang đọc — chạm để dừng' : label
    : undefined;
  return (
    <button
      type="button"
      className={`read-aloud-btn is-${status} ${label ? 'has-label' : ''} ${className}`}
      title={status === 'playing' ? 'Dừng' : title}
      aria-label={status === 'playing' ? 'Dừng đọc' : (label ?? title)}
      onClick={() => void play()}
    >
      <span aria-hidden="true">{icon}</span>
      {shownLabel && <span className="read-aloud-label">{shownLabel}</span>}
    </button>
  );
}
