// Dead-simple ephemeral toast (no lib). One message at a time; auto-dismiss.
import { useCallback, useRef, useState } from 'react';

export interface Toast {
  msg: string;
  kind: 'ok' | 'err';
}

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    window.clearTimeout(timer.current);
    setToast({ msg, kind });
    timer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  return { toast, show };
}
