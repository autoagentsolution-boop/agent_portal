// Subscribe to per-user `node.status` SSE events for a single workflow run, so the
// Orchestrate panel animates node states live as the executor advances (mirrors
// use-post-events.ts). The EventSource carries the HttpOnly session cookie via
// withCredentials — no token in the URL. Pass runId=null to stay disconnected.
import { useEffect, useRef, useState } from 'react';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export interface NodeStatusEvent {
  type: 'node.status';
  runId: string;
  nodeId: string;
  agentId: string;
  status: string;
  error?: string | null;
  // Optimal-time publish suggestion, set on the publisher node's awaiting_approval event.
  timingSuggestion?: string | null;
  // Informational hold notice (e.g. "Holding publish — N step(s) still in progress") —
  // distinct from `error`, not a failure. Set on the same awaiting_approval event.
  notice?: string | null;
}

// onEvent fires only for events matching the active runId. Subscription resets
// whenever runId changes (new run) so stale streams never patch the wrong run.
export function useRunEvents(runId: string | null, onEvent: (e: NodeStatusEvent) => void): boolean {
  const [live, setLive] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!runId) { setLive(false); return; }
    const es = new EventSource(`${BASE}/events`, { withCredentials: true });
    es.addEventListener('ready', () => setLive(true));
    es.addEventListener('node.status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as NodeStatusEvent;
        if (data.runId === runId) cb.current(data);
      } catch { /* ignore malformed frame */ }
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [runId]);

  return live;
}
