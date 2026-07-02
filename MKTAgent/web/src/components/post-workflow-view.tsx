// The orchestration workflow behind a post — the PLAYGROUND. A post created under a
// flow-attached campaign carries runId (an instance cloned from the flow template). This
// is where the user runs the workflow, watches the DAG live, inspects each node's output,
// re-runs a step, and approves publishing. The flow itself is a read-only blueprint;
// execution lives here. DAG is open by default (no collapse) so the graph is visible.
import { useEffect, useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';
import { useRunEvents } from '../hooks/use-run-events';
import { RunDagView } from './run-dag-view';
import { ConnectionRequired } from './connection-required';
import { formatArtifact } from '../flow/artifact-format';

interface Props {
  runId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const STATUS_HINT: Record<string, string> = {
  planned: 'Ready to run — click Execute to generate this post step by step.',
  running: 'Running… watch each step light up below.',
  needs_approval: 'Paused before publishing — approve to post (dry-run by default).',
  needs_connection: 'Connect a platform before running.',
  completed: 'Completed. Click any step to review or re-run it.',
  failed: 'A step failed — fix and re-run, or re-run the flow.',
};

export function PostWorkflowView({ runId, notify }: Props) {
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.getRun(runId);
    if (r.ok) setRun(r.data);
    else notify(`Load workflow: ${r.error.error}`, 'err');
  };
  useEffect(() => { setRun(null); setSelectedNode(null); void load(); }, [runId]);

  const liveId = run && (run.status === 'running' || run.status === 'needs_approval') ? run.id : null;
  useRunEvents(liveId, (ev) => {
    setRun((cur) => cur && cur.id === ev.runId
      ? { ...cur, nodes: cur.nodes.map((n) => n.nodeId === ev.nodeId ? { ...n, status: ev.status, error: ev.error ?? n.error } : n) }
      : cur);
    if (ev.status === 'completed' || ev.status === 'failed') void load();
  });

  const execute = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) { notify(`Execute: ${r.error.error}`, 'err'); return; }
      setRun(r.data); notify('Workflow executing…');
    } finally { setBusy(false); }
  };

  const approveNode = async (nodeId: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.approveRunNode(run.id, nodeId);
      if (!r.ok) { notify(`Approve: ${r.error.error}`, 'err'); return; }
      setRun(r.data); notify('Publishing…');
    } finally { setBusy(false); }
  };

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

  if (!run) return <div className="post-workflow"><p className="muted small">Loading workflow…</p></div>;

  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  const publishArtifact = run.artifacts.find((a) => a.type === 'publish_result');
  const publishUrls = (publishArtifact?.data as { postUrls?: Record<string, string> | null } | undefined)?.postUrls ?? null;
  const requiredActions = run.requiredActions ?? [];
  // needs_connection with cards handled by the ConnectionRequired block (its own continue
  // re-resolves). requiredActions only rides the POST /execute response — a reloaded gated
  // run (GET) has none, so keep Execute available there to re-run the resolver server-side.
  const canExecute =
    run.status === 'planned' || run.status === 'failed' ||
    (run.status === 'needs_connection' && requiredActions.length === 0);

  const selectedNodeRun = selectedNode ? run.nodes.find((n) => n.nodeId === selectedNode) : null;
  const selectedArtifact = selectedNode ? run.artifacts.find((a) => a.nodeId === selectedNode) : null;
  const selectedView = selectedArtifact ? formatArtifact(selectedArtifact.type, selectedArtifact.data) : null;
  // The publisher runs via the approval gate, not re-run; only finished steps re-run.
  const canRerun = Boolean(
    selectedNodeRun &&
    selectedNodeRun.agentId !== 'publisher' &&
    (selectedNodeRun.status === 'completed' || selectedNodeRun.status === 'failed') &&
    run.status !== 'running',
  );

  return (
    <div className="post-workflow open">
      <div className="post-workflow-head">
        <span className="post-workflow-title">Workflow · {run.nodes.length} steps</span>
        {canExecute && (
          <button className="btn small primary" disabled={busy} onClick={() => void execute()}>
            {busy ? 'Starting…' : run.status === 'failed' ? '↻ Re-run flow' : run.status === 'needs_connection' ? 'Check connection & run' : '▶ Execute'}
          </button>
        )}
      </div>
      <p className="muted small">{STATUS_HINT[run.status] ?? run.status}</p>

      <div className="post-workflow-body">
        <RunDagView nodes={run.nodes} publishUrls={publishUrls} platforms={(run.goal as { platforms?: string[] } | null)?.platforms ?? []} onSelectNode={setSelectedNode} selectedNodeId={selectedNode} />

        {run.status === 'needs_connection' && requiredActions.length > 0 && (
          <ConnectionRequired actions={requiredActions} busy={busy} onContinue={() => void execute()} />
        )}

        {run.status === 'needs_approval' && gateNode && (
          <div className="gate-block">
            <p className="muted small">Paused before <strong>{gateNode.agentId.replace(/_/g, ' ')}</strong> — an external action. Approve to proceed.</p>
            <button className="btn primary" disabled={busy} onClick={() => void approveNode(gateNode.nodeId)}>
              {busy ? 'Publishing…' : `Approve ${gateNode.agentId.replace(/_/g, ' ')}`}
            </button>
          </div>
        )}

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
              <p className="muted small">This step hasn't produced output yet — run the flow to populate it.</p>
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
    </div>
  );
}
