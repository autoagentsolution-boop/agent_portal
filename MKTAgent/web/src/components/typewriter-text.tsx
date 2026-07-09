// Typewriter reveal (Command Center Unification P3) — a PURELY VISUAL effect that makes Atria feel
// alive by revealing a reply progressively, char-by-char, with a blinking caret. It is NOT LLM token
// streaming: the full text is already known; we just meter its appearance. Designed as a seam so a
// future voice/TTS layer can subscribe to the same reveal cadence.
import { useEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  animate?: boolean;   // false → show instantly (restored history, non-newest bubbles)
  speed?: number;      // ms per tick
  charsPerTick?: number;
}

export function TypewriterText({ text, animate = true, speed = 16, charsPerTick = 2 }: Props) {
  const [count, setCount] = useState(animate ? 0 : text.length);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!animate) { setCount(text.length); return; }
    setCount(0);
    let i = 0;
    timer.current = setInterval(() => {
      i += charsPerTick;
      if (i >= text.length) {
        setCount(text.length);
        if (timer.current) clearInterval(timer.current);
      } else {
        setCount(i);
      }
    }, speed);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [text, animate, speed, charsPerTick]);

  const done = count >= text.length;
  return (
    <>
      {text.slice(0, count)}
      {animate && !done && <span className="tw-caret" aria-hidden="true">▋</span>}
    </>
  );
}
