// Shared DAG renderer for a workflow run's node list. Used by the in-chat PlanCard
// (planning preview) and the Active Flows run detail (live execution). Pure UI: the
// caller owns state + click handling. Live node dots come from the run's node.status,
// which SSE patches in the run-detail case.
import { useEffect, useRef, useState } from 'react';
import type { WorkflowRunDto } from '../api/client';
import { creditsFromTokens, creditsFromUsd } from '../lib/credits';

type Node = WorkflowRunDto['nodes'][number];

export const NODE_DOT: Record<string, string> = {
  pending: '○', running: '◐', awaiting_approval: '⏸', completed: '●', failed: '✕', skipped: '–',
  needs_connection: '⚷',
};

const agentLabel = (id: string): string => (id === 'scheduler' ? '⏰ scheduler' : id.replace(/_/g, ' '));

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
  return <span className="dag-elapsed">processing · {fmtDuration(s)}</span>;
}

// mm:ss (or Hh Mm for long runs). Used by both the live ticker and the persisted
// per-node runtime shown once a node reaches a terminal state.
function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Persisted per-node stats shown after a node finishes: total runtime (from the
// server's started/finished timestamps, so it survives remounts/reloads unlike the
// live ticker) plus input/output token counts. Rendered only when data exists.
function NodeStats({ node }: { node: Node }) {
  const dur =
    node.startedAt && node.finishedAt
      ? (new Date(node.finishedAt).getTime() - new Date(node.startedAt).getTime()) / 1000
      : null;
  const inTok = node.promptTokens ?? 0;
  const outTok = node.outputTokens ?? 0;
  const totalTok = inTok + outTok;
  const cost = node.costUsd ?? 0;
  // ONE consistent unit across every node (feedback: some nodes showed tokens, others USD — jarring).
  // Basis = the node's TOTAL spend in USD (node.costUsd already SUMS token cost + any media flat, per
  // the backend's costFields/sumCost). Deriving credits from it fixes the storyboard >10× undercount
  // (H6): the old ternary took the token branch and dropped the flat frame USD folded into costUsd.
  // costUsd is also model-tier-accurate (pro/lite priced right), unlike a flat tokens/250. Fall back
  // to tokens only when a node recorded tokens but no USD (stub/accounting gap). Raw tokens/USD on hover.
  const credits = cost > 0 ? creditsFromUsd(cost) : creditsFromTokens(totalTok);
  const detail = totalTok > 0 ? `↑${inTok} ↓${outTok} tokens` : cost > 0 ? `$${cost.toFixed(3)}` : '';
  if (dur === null && credits === 0) return null;
  return (
    <span className="dag-stats">
      {dur !== null && <span className="dag-stat dag-stat-time" title="total runtime">⏱ {fmtDuration(dur)}</span>}
      {credits > 0 && (
        <span className="dag-stat dag-stat-tok" title={detail}>≈{fmtTokens(credits)} cr</span>
      )}
    </span>
  );
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
  // Informational hold notice per node (nodeId → text), e.g. the publisher node holding
  // because other steps are still in progress. Comes from the live node.status SSE event —
  // not persisted on the run, so the caller keeps it in its own state and passes it down.
  notices?: Record<string, string>;
  // Generic scheduler: the confirmed UTC resume instant of a parked run. When set, a "⏰ Scheduled for
  // {local time}" chip renders under the scheduler node (converted to the viewer's local timezone).
  scheduledResumeAt?: string | null;
}

export function RunDagView({ nodes, publishUrls, platforms, onSelectNode, selectedNodeId, notices, scheduledResumeAt }: Props) {
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
            {n.status === 'completed' && <NodeStats node={n} />}
            {n.agentId === 'scheduler' && scheduledResumeAt && (
              <span className="dag-notice">⏰ Scheduled for {new Date(scheduledResumeAt).toLocaleString()}</span>
            )}
            {n.error && <span className="dag-err">{n.error}</span>}
            {notices?.[n.nodeId] && <span className="dag-notice">{notices[n.nodeId]}</span>}
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
