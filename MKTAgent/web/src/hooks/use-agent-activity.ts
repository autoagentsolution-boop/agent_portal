// Live "which agents are working right now" for the Command Center neural graph (W1). Opens ONE
// owner-scoped EventSource to /events and tracks the set of agentIds whose latest node.status is
// `running`, across ANY run (chat-hosted, post board, or the autonomy cron). The registry agent ids
// (concept_writer, video, publisher, …) equal the SSE `agentId`, so the CC lights the matching node.
//
// Decoupled by design: the graph doesn't need to know which run is active — any running node lights
// its agent. Removed on every terminal/paused transition so a node never stays stuck lit.
import { useEffect, useState } from 'react';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

interface NodeStatusFrame {
  type: 'node.status';
  agentId: string;
  status: string;
}

// A node is "working" only while running; every other state (completed, failed, skipped, aborted,
// awaiting_approval, pending) clears it so the glow tracks real activity, not history.
export function useAgentActivity(enabled: boolean): Set<string> {
  const [active, setActive] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled) { setActive(new Set()); return; }
    const es = new EventSource(`${BASE}/events`, { withCredentials: true });
    es.addEventListener('node.status', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as NodeStatusFrame;
        if (!d.agentId) return;
        setActive((prev) => {
          const running = d.status === 'running';
          if (running === prev.has(d.agentId)) return prev; // no-op → avoid needless re-render
          const next = new Set(prev);
          if (running) next.add(d.agentId);
          else next.delete(d.agentId);
          return next;
        });
      } catch { /* ignore malformed frame */ }
    });
    // On any drop, clear activity so stale glows don't linger through a reconnect.
    es.onerror = () => setActive((prev) => (prev.size ? new Set() : prev));
    return () => es.close();
  }, [enabled]);

  return active;
}
