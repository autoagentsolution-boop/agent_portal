// Subscribe to per-user `node.status` SSE events (shared events bus) for a single workflow run, so
// the Orchestrate panel animates node states live as the executor advances. Pass runId=null to stay
// disconnected (still no dedicated connection — the bus filters by runId here).
import { useEffect, useRef, useState } from 'react';
import { subscribeEvents } from './events-bus.ts';

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
    return subscribeEvents({
      onReady: () => setLive(true),
      onError: () => setLive(false),
      on: { 'node.status': (d) => { if ((d as { runId?: string }).runId === runId) cb.current(d as unknown as NodeStatusEvent); } },
    });
  }, [runId]);

  return live;
}
