// Live-refresh trigger for a Workspace panel (Atria v2 P1). A workspace spans MANY runs (one per
// post), so unlike useRunEvents (single runId) this multiplexes: it fires `onChange` whenever a
// `node.status` SSE frame belongs to ANY of the workspace's runs. The panel responds by refetching
// getWorkspace (SSE as a "something moved" signal, not a per-field patch — the rollup is cheap and
// always consistent). EventSource carries the session cookie via withCredentials; no token in URL.
import { useEffect, useRef, useState } from 'react';
import { subscribeEvents } from './events-bus.ts';

// `key` resets the subscription (e.g. the open workspace's campaignId). `runIds` is read through a
// ref so the panel reloading its run set does NOT churn the subscription — only `key` re-subscribes.
export function useWorkspaceEvents(
  key: string | null,
  runIds: string[],
  onChange: () => void,
): boolean {
  const [live, setLive] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;
  const ids = useRef<Set<string>>(new Set());
  ids.current = new Set(runIds);

  useEffect(() => {
    if (!key) { setLive(false); return; }
    return subscribeEvents({
      onReady: () => setLive(true),
      onError: () => setLive(false),
      on: { 'node.status': (d) => { const rid = (d as { runId?: string }).runId; if (rid && ids.current.has(rid)) cb.current(); } },
    });
  }, [key]);

  return live;
}
