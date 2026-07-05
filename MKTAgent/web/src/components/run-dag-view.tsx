// Shared DAG renderer for a workflow run's node list. Used by the in-chat PlanCard
// (planning preview) and the Active Flows run detail (live execution). Pure UI: the
// caller owns state + click handling. Live node dots come from the run's node.status,
// which SSE patches in the run-detail case.
import { useEffect, useRef, useState } from 'react';
import type { WorkflowRunDto } from '../api/client';

type Node = WorkflowRunDto['nodes'][number];

export const NODE_DOT: Record<string, string> = {
  pending: '○', running: '◐', awaiting_approval: '⏸', completed: '●', failed: '✕', skipped: '–',
  needs_connection: '⚷',
};

const agentLabel = (id: string): string => id.replace(/_/g, ' ');

// Live-ticking elapsed timer for a node that's currently running. Long steps (video
// generation runs ~30-90s) otherwise look frozen — this makes it obvious work is
// ongoing. Counts from mount, i.e. when this client first saw the node enter `running`.
function RunningElapsed() {
  const start = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - start.current) / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return <span className="dag-elapsed">processing · {mm}:{ss}</span>;
}

interface Props {
  nodes: Node[];
  // Per-platform publish links to render under the publisher node (run detail).
  publishUrls?: Record<string, string> | null;
  // Selected publish targets — shown under the publisher node BEFORE publishing so the
  // user sees where this will go (the "publisher hides chosen platforms" gap). Once
  // published, publishUrls (with links) takes over.
  platforms?: string[];
  // When set, nodes are clickable (run detail → open that node's artifact).
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

export function RunDagView({ nodes, publishUrls, platforms, onSelectNode, selectedNodeId }: Props) {
  const platformRows = Object.entries(publishUrls ?? {});
  const targetPlatforms = platforms ?? [];
  return (
    <ol className="dag-list">
      {nodes.map((n) => {
        const clickable = Boolean(onSelectNode);
        return (
          <li
            key={n.nodeId}
            className={`dag-node st-${n.status} ${clickable ? 'clickable' : ''} ${selectedNodeId === n.nodeId ? 'selected' : ''}`}
            onClick={clickable ? () => onSelectNode!(n.nodeId) : undefined}
          >
            <span className="dag-dot">{NODE_DOT[n.status] ?? '○'}</span>
            <span className="dag-agent">{agentLabel(n.agentId)}</span>
            {n.dependsOn.length > 0 && <span className="dag-dep">after {n.dependsOn.join(', ')}</span>}
            {n.status === 'running' && <RunningElapsed key={`${n.nodeId}-elapsed`} />}
            {n.error && <span className="dag-err">{n.error}</span>}
            {n.agentId === 'publisher' && platformRows.length > 0 && (
              <ul className="publish-subrows">
                {platformRows.map(([platform, url]) => (
                  <li key={platform} className="publish-subrow">
                    <span className="publish-platform">{platform}</span>
                    {url ? <a href={url} target="_blank" rel="noreferrer">view post ↗</a> : <span className="muted small">no url</span>}
                  </li>
                ))}
              </ul>
            )}
            {/* Before publish (no URLs yet): show the chosen target platforms so the plan
                makes the publish destination explicit. */}
            {n.agentId === 'publisher' && platformRows.length === 0 && targetPlatforms.length > 0 && (
              <span className="dag-targets">→ {targetPlatforms.join(', ')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
