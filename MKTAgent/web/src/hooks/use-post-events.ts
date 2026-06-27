// Subscribe to the per-user SSE stream (GET /events). The browser EventSource
// sends the HttpOnly session cookie automatically (withCredentials) — no token in
// the URL. Each `post.status` event invokes onEvent so the board can patch a row
// in place without a full refetch.
import { useEffect, useRef, useState } from 'react';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export interface PostStatusEvent {
  type: 'post.status';
  postId: string;
  status: string;
  campaignId?: string;
  postUrls?: Record<string, string> | null;
  error?: string | null;
}

export function usePostEvents(onEvent: (e: PostStatusEvent) => void): boolean {
  const [live, setLive] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    const es = new EventSource(`${BASE}/events`, { withCredentials: true });
    es.addEventListener('ready', () => setLive(true));
    es.addEventListener('post.status', (ev) => {
      try {
        cb.current(JSON.parse((ev as MessageEvent).data));
      } catch { /* ignore malformed frame */ }
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  return live;
}
