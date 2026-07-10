// Subscribe to the per-user SSE stream (shared events bus → GET /events). Each `post.status`
// event invokes onEvent so the board can patch a row in place without a full refetch.
import { useEffect, useRef, useState } from 'react';
import { subscribeEvents } from './events-bus.ts';

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

  useEffect(() => subscribeEvents({
    onReady: () => setLive(true),
    onError: () => setLive(false),
    on: { 'post.status': (d) => cb.current(d as unknown as PostStatusEvent) },
  }), []);

  return live;
}
