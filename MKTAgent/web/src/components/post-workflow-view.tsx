// The orchestration workflow behind a post, shown inline under the PostCard. A post
// created by a flow carries runId → we load that run and render its DAG (the same
// RunDagView used in Active Flows). Clicking a node shows that node's output as clean
// text + the real image (never raw JSON). Live node dots come from SSE while the run
// executes. Phase 4 adds a per-node "Re-run" control here; this phase is read-only.
import { useEffect, useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';
import { useRunEvents } from '../hooks/use-run-events';
import { RunDagView } from './run-dag-view';
import { formatArtifact } from '../flow/artifact-format';

interface Props {
  runId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

export function PostWorkflowView({ runId, notify }: Props) {
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.getRun(runId);
    if (r.ok) setRun(r.data);
    else notify(`Load workflow: ${r.error.error}`, 'err');
  };
  useEffect(() => { if (open && !run) void load(); }, [open]);

  const liveId = open && run && (run.status === 'running' || run.status === 'needs_approval') ? run.id : null;
  useRunEvents(liveId, (ev) => {
    setRun((cur) => cur && cur.id === ev.runId
      ? { ...cur, nodes: cur.nodes.map((n) => n.nodeId === ev.nodeId ? { ...n, status: ev.status, error: ev.error ?? n.error } : n) }
      : cur);
    if (ev.status === 'completed' || ev.status === 'failed') void load();
  });

  const rerun = async (nodeId: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.rerunRunNode(run.id, nodeId);
      if (!r.ok) { notify(`Re-run: ${r.error.error}`, 'err'); return; }
      setRun(r.data);
      notify('Re-running step — downstream steps marked stale');
    } finally { setBusy(false); }
  };

  const selectedNodeRun = selectedNode && run ? run.nodes.find((n) => n.nodeId === selectedNode) : null;
  const selectedArtifact = selectedNode && run ? run.artifacts.find((a) => a.nodeId === selectedNode) : null;
  const selectedView = selectedArtifact ? formatArtifact(selectedArtifact.type, selectedArtifact.data) : null;
  // The publisher runs via the approval gate, not re-run; only finished steps re-run.
  const canRerun = Boolean(
    selectedNodeRun &&
    selectedNodeRun.agentId !== 'publisher' &&
    (selectedNodeRun.status === 'completed' || selectedNodeRun.status === 'failed') &&
    run?.status !== 'running',
  );

  return (
    <div className="post-workflow">
      <button className="post-workflow-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Workflow{run ? ` · ${run.nodes.length} steps` : ''}
      </button>
      {open && (
        run ? (
          <div className="post-workflow-body">
            <RunDagView nodes={run.nodes} onSelectNode={setSelectedNode} selectedNodeId={selectedNode} />
            {selectedNode && (
              <div className="artifact-view">
                {selectedView ? (
                  <>
                    <div className="section-title">{selectedView.title}</div>
                    {selectedView.imageUrl && (
                      <img className="artifact-image" src={selectedView.imageUrl} alt={selectedView.title} loading="lazy" />
                    )}
                    {selectedView.fields.map((f) => (
                      <div className="artifact-field" key={f.label}><strong>{f.label}</strong><p>{f.value}</p></div>
                    ))}
                    {selectedView.fields.length === 0 && !selectedView.imageUrl && <p className="muted small">No output yet for this step.</p>}
                  </>
                ) : (
                  <p className="muted small">This step hasn't produced output yet.</p>
                )}
                {canRerun && (
                  <div className="rerun-row">
                    <button className="btn small" disabled={busy} onClick={() => void rerun(selectedNode!)}>
                      {busy ? 'Re-running…' : '↻ Re-run this step'}
                    </button>
                    <span className="muted small">Regenerates this step. Later steps are marked stale — re-run them too before publishing.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : <p className="muted small">Loading workflow…</p>
      )}
    </div>
  );
}
