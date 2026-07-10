// Read-aloud — a speaker button that plays TTS for a chunk of text (an Atria reply or the Impact
// headline). Delegates to the shared tts-player (lib/tts-player.ts), which owns the single-narration
// guard, blob lifecycle, 502 retry, and voice-viz routing — so a click and voice-mode auto-read never
// double-play and barge-in works uniformly.
import { useEffect, useRef, useState } from 'react';
import { speak, stopSpeaking } from '../lib/tts-player.ts';

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
  const playingRef = useRef(false); // this button owns the current narration
  // Synchronous guard: state is async, so two fast clicks both see 'idle' and each fetch. A ref blocks
  // the second click immediately.
  const busyRef = useRef(false);

  // If this bubble scrolls away mid-narration, stop it (it's the current audio) so it doesn't play on.
  useEffect(() => () => { if (playingRef.current) stopSpeaking(); }, []);

  const play = async () => {
    if (status === 'playing') { stopSpeaking(); return; } // toggle off
    if (busyRef.current || status === 'loading') return;
    if (!text.trim()) return;
    busyRef.current = true;
    setStatus('loading');
    try {
      await speak(text, {
        onStart: () => { playingRef.current = true; setStatus('playing'); },
        onEnd: () => { playingRef.current = false; setStatus('idle'); },
      });
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
