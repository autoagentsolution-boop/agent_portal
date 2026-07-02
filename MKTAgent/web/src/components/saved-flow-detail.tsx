// Saved Flow detail — the real run behind a Saved Flow, shown in Active Flows. Loads
// the run (nodes + artifacts), executes it ASYNC (the executor runs detached server-
// side; SSE drives live node dots so there's no stuck "Thinking"), halts at the
// publisher gate (manual approve, DRY by default), and lets the user click a node to
// view that node's output as CLEAN TEXT (+ the real generated image) — never raw JSON.
import { useEffect, useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';
import { useRunEvents } from '../hooks/use-run-events';
import { RunDagView } from './run-dag-view';
import { ConnectionRequired } from './connection-required';
import { NodeSetupStatus } from './node-setup-status';
import { formatArtifact } from '../flow/artifact-format';

interface Props {
  runId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onStatusChange: () => void; // bump the saved-flows list when status changes
  onOpenConnections?: () => void;
  onCreateCampaign?: (flowId: string) => void; // template blueprint → start a campaign
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Ready to run', running: 'Running…', needs_approval: 'Paused — approve to publish',
  completed: 'Completed', failed: 'Failed', awaiting_clarification: 'Needs detail',
  needs_connection: 'Connect a platform to run', template: 'Approved blueprint',
};

// Short, human role for each agent so the blueprint reads as a "team" a non-tech user
// (and a technical buyer) can grasp at a glance. Falls back to the humanized id.
const AGENT_ROLE: Record<string, string> = {
  ideation: 'Brainstorms campaign directions and picks the strongest angle',
  strategy: 'Turns the idea into positioning, audience and content pillars',
  content_search: 'Gathers research, references and proof points',
  concept_writer: 'Writes the campaign angle and copy variants',
  infographic: 'Generates the marketing image',
  storyboard: 'Plans the video scenes and script',
  video: 'Produces the video prompt',
  publisher: 'Publishes to your connected platforms (approval required)',
};

export function SavedFlowDetail({ runId, notify, onStatusChange, onOpenConnections, onCreateCampaign }: Props) {
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const load = async () => {
    const r = await api.getRun(runId);
    if (r.ok) setRun(r.data); else notify(`Load flow: ${r.error.error}`, 'err');
  };
  useEffect(() => { setRun(null); setSelectedNode(null); setRenaming(false); void load(); }, [runId]);

  const commitRename = async () => {
    if (!run) return;
    const next = nameDraft.trim();
    if (!next || next === (run.name ?? '')) { setRenaming(false); return; }
    setBusy(true);
    try {
      const r = await api.renameRun(run.id, next);
      if (!r.ok) { notify(`Rename: ${r.error.error}`, 'err'); return; }
      setRun(r.data); setRenaming(false); onStatusChange(); notify('Flow renamed');
    } finally { setBusy(false); }
  };

  // Live node status while executing. Terminal events refetch so artifacts land.
  const liveId = run && (run.status === 'running' || run.status === 'needs_approval') ? run.id : null;
  useRunEvents(liveId, (ev) => {
    setRun((cur) => cur && cur.id === ev.runId
      ? { ...cur, nodes: cur.nodes.map((n) => n.nodeId === ev.nodeId ? { ...n, status: ev.status, error: ev.error ?? n.error } : n) }
      : cur);
    if (ev.status === 'completed' || ev.status === 'failed') { void load(); onStatusChange(); }
  });

  const execute = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) { notify(`Execute: ${r.error.error}`, 'err'); return; }
      setRun(r.data); onStatusChange(); notify('Flow executing…');
    } finally { setBusy(false); }
  };

  const approveNode = async (nodeId: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.approveRunNode(run.id, nodeId);
      if (!r.ok) { notify(`Approve: ${r.error.error}`, 'err'); return; }
      setRun(r.data); onStatusChange(); notify('Publishing…');
    } finally { setBusy(false); }
  };

  if (!run) return <div className="card compact"><p className="muted">Loading flow…</p></div>;

  // Template = an approved, frozen blueprint: the agent "team" the user chose, read-only.
  // It is never executed here — the user creates a campaign, then posts under it clone
  // this blueprint and run independently. No execute button, no gate, no artifacts.
  if (run.kind === 'template') {
    return (
      <div className="card compact saved-flow-detail">
        <div className="spread">
          <div>
            <div className="eyebrow">Flow blueprint</div>
            {renaming ? (
              <div className="flow-rename">
                <input
                  aria-label="Flow name"
                  autoFocus
                  value={nameDraft}
                  disabled={busy}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                />
                <button className="btn primary" disabled={busy} onClick={() => void commitRename()}>{busy ? 'Saving…' : 'Save'}</button>
                <button className="btn" disabled={busy} onClick={() => setRenaming(false)}>Cancel</button>
              </div>
            ) : (
              <h3 className="flow-title">
                {run.name ?? 'Untitled flow'}
                <button className="icon-btn rename-btn" aria-label="Rename flow" title="Rename flow" onClick={() => { setNameDraft(run.name ?? ''); setRenaming(true); }}>✎</button>
              </h3>
            )}
            <span className="flow-status st-template">Approved blueprint · {run.nodes.length} agents</span>
          </div>
          {onCreateCampaign && (
            <button className="btn primary" onClick={() => onCreateCampaign(run.id)}>➕ New campaign from this flow</button>
          )}
        </div>

        <p className="muted small">
          This is the agent team you approved — reused across campaigns. It doesn't run on its own:
          create a campaign, then each post under it runs this flow and you can review every step.
        </p>

        <ol className="blueprint-team">
          {run.nodes.map((n, i) => (
            <li className="blueprint-agent" key={n.nodeId}>
              <span className="blueprint-index">{i + 1}</span>
              <div>
                <strong>{n.agentId.replace(/_/g, ' ')}</strong>
                <p className="muted small">{AGENT_ROLE[n.agentId] ?? 'Agent step'}</p>
                {n.dependsOn.length > 0 && <span className="dag-dep">after {n.dependsOn.join(', ')}</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  const publishArtifact = run.artifacts.find((a) => a.type === 'publish_result');
  const publishUrls = (publishArtifact?.data as { postUrls?: Record<string, string> | null } | undefined)?.postUrls ?? null;
  const requiredActions = run.requiredActions ?? [];
  // needs_connection with cards loaded is handled by the ConnectionRequired block (its
  // own continue button re-resolves). But requiredActions only rides the POST /execute
  // response — a reopened/reloaded gated run (GET) has none, so without this the user
  // would see no actionable control. Re-executing re-runs the resolver server-side.
  const canExecute =
    run.status === 'planned' || run.status === 'failed' ||
    (run.status === 'needs_connection' && requiredActions.length === 0);
  const selectedNodeRun = selectedNode ? run.nodes.find((n) => n.nodeId === selectedNode) : null;
  const selectedArtifact = selectedNode ? run.artifacts.find((a) => a.nodeId === selectedNode) : null;
  const selectedView = selectedArtifact ? formatArtifact(selectedArtifact.type, selectedArtifact.data) : null;

  return (
    <div className="card compact saved-flow-detail">
      <div className="spread">
        <div>
          <div className="eyebrow">Saved flow</div>
          {renaming ? (
            <div className="flow-rename">
              <input
                aria-label="Flow name"
                autoFocus
                value={nameDraft}
                disabled={busy}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(); if (e.key === 'Escape') setRenaming(false); }}
              />
              <button className="btn primary" disabled={busy} onClick={() => void commitRename()}>{busy ? 'Saving…' : 'Save'}</button>
              <button className="btn" disabled={busy} onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          ) : (
            <h3 className="flow-title">
              {run.name ?? 'Untitled flow'}
              <button className="icon-btn rename-btn" aria-label="Rename flow" title="Rename flow" onClick={() => { setNameDraft(run.name ?? ''); setRenaming(true); }}>✎</button>
            </h3>
          )}
          <span className={`flow-status st-${run.status}`}>{STATUS_LABEL[run.status] ?? run.status}</span>
        </div>
        {canExecute && (
          <button className="btn primary" disabled={busy} onClick={() => void execute()}>
            {busy ? 'Starting…' : run.status === 'failed' ? 'Re-run flow' : run.status === 'needs_connection' ? 'Check connection & run' : 'Execute flow'}
          </button>
        )}
      </div>

      <p className="muted small">Click a step to view its output. Publishing pauses for your approval (safe / dry-run by default).</p>
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
                <div className="artifact-field" key={f.label}>
                  <strong>{f.label}</strong>
                  <p>{f.value}</p>
                </div>
              ))}
              {selectedView.fields.length === 0 && !selectedView.imageUrl && <p className="muted small">No output yet for this step.</p>}
            </>
          ) : (
            <p className="muted small">This step hasn't produced output yet — run the flow to populate it.</p>
          )}
          {selectedNodeRun && (
            <NodeSetupStatus agentId={selectedNodeRun.agentId} onOpenConnections={onOpenConnections} />
          )}
        </div>
      )}
    </div>
  );
}
