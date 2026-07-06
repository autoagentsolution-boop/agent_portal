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
import { PublishReview } from './publish-review';
import { ConceptSelectionGate } from './concept-selection-gate';
import { formatArtifact } from '../flow/artifact-format';

interface Props {
  runId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onOpenConnections?: () => void;
}

const STATUS_HINT: Record<string, string> = {
  planned: 'Ready to run — click Execute to generate this post step by step.',
  running: 'Running… watch each step light up below.',
  needs_approval: 'Paused before publishing — approve to post (dry-run by default).',
  needs_connection: 'Connect a platform before running.',
  completed: 'Completed. Click any step to review or re-run it.',
  failed: 'A step failed — fix and re-run, or re-run the flow.',
};

interface Copy { body: string; threads: string; x: string }

// The executor is detached: it emits a node's `running` SSE event within milliseconds of
// launch — usually BEFORE the browser's EventSource connects, and SSE has no replay. So we
// optimistically flip the node that's about to run to `running` right off the API response,
// otherwise it sits on its stale dot (○) until `completed` lands ~60s later (video gen).
const markRunning = (run: WorkflowRunDto, nodeId: string | null): WorkflowRunDto =>
  nodeId ? { ...run, nodes: run.nodes.map((n) => n.nodeId === nodeId ? { ...n, status: 'running' } : n) } : run;

// First pending node whose deps are all satisfied — the frontier the executor runs next.
const nextRunnableNodeId = (nodes: WorkflowRunDto['nodes']): string | null => {
  const done = new Set(nodes.filter((n) => n.status === 'completed' || n.status === 'skipped').map((n) => n.nodeId));
  return nodes.find((n) => n.status === 'pending' && n.dependsOn.every((d) => done.has(d)))?.nodeId ?? null;
};

export function PostWorkflowView({ runId, notify, onOpenConnections }: Props) {
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Live per-node hold notices (nodeId → text) from node.status SSE events — not persisted
  // on the run DTO, so kept separately and reset whenever we switch/reload the run.
  const [notices, setNotices] = useState<Record<string, string>>({});
  // Concept-copy editors (inline manual edit + LLM refine on the concept_writer artifact).
  const [editCopy, setEditCopy] = useState<Copy | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');

  const load = async () => {
    const r = await api.getRun(runId);
    if (r.ok) setRun(r.data);
    else notify(`Load workflow: ${r.error.error}`, 'err');
  };
  useEffect(() => { setRun(null); setSelectedNode(null); setNotices({}); void load(); }, [runId]);

  const liveId = run && (run.status === 'running' || run.status === 'needs_approval') ? run.id : null;
  useRunEvents(liveId, (ev) => {
    setRun((cur) => cur && cur.id === ev.runId
      ? { ...cur, nodes: cur.nodes.map((n) => n.nodeId === ev.nodeId ? { ...n, status: ev.status, error: ev.error ?? n.error } : n) }
      : cur);
    if (ev.notice) setNotices((prev) => ({ ...prev, [ev.nodeId]: ev.notice! }));
    if (ev.status === 'completed' || ev.status === 'failed') void load();
  });

  const execute = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) { notify(`Execute: ${r.error.error}`, 'err'); return; }
      // Only optimistically show running when the run actually started (not gated to
      // needs_connection, where no node runs yet).
      setRun(r.data.status === 'running' ? markRunning(r.data, nextRunnableNodeId(r.data.nodes)) : r.data);
      notify('Workflow executing…');
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
      // rerun-node launches the executor on exactly this node and returns status=running;
      // show it running immediately (the response still carries the reset pending node).
      setRun(markRunning(r.data, nodeId));
      notify('Re-running step — downstream steps marked stale');
    } finally { setBusy(false); }
  };

  // Save a hand-edited copy (no LLM). Reloads the run so the concept artifact re-renders.
  const saveCopy = async (postId: string) => {
    if (!editCopy) return;
    setBusy(true);
    try {
      const r = await api.editCopy(postId, editCopy);
      if (!r.ok) { notify(`Save copy: ${r.error.error}`, 'err'); return; }
      setEditCopy(null); notify('Copy updated'); await load();
    } finally { setBusy(false); }
  };

  // Refine copy via LLM instruction (targeted edit, keeps audit trail).
  const refineCopy = async (postId: string) => {
    const text = refineText.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await api.refine(postId, text);
      if (!r.ok) { notify(`Refine: ${r.error.error}`, 'err'); return; }
      setRefineOpen(false); setRefineText(''); notify('Copy refined'); await load();
    } finally { setBusy(false); }
  };

  if (!run) return <div className="post-workflow"><p className="muted small">Loading workflow…</p></div>;

  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  // The needs_approval hint depends on WHICH gate we're at — the video cost-gate reads
  // differently from the publisher external-write gate.
  const statusHint = run.status === 'needs_approval' && gateNode?.agentId === 'video'
    ? 'Paused before video generation (the costly step) — review the storyboard, then approve.'
    : run.status === 'needs_approval' && gateNode?.agentId === 'concept_writer'
      ? 'Concept ready — pick the version you like (and optionally add a reference image), then Continue.'
      : STATUS_HINT[run.status] ?? run.status;
  // The post backing this run (post.runId = run.id). Prefer the run's createdPostId; fall
  // back to any artifact that carries a postId (concept_writer stamps it). Drives the
  // publish review at the approval gate.
  const runPostId =
    run.createdPostId ??
    (run.artifacts.find((a) => (a.data as { postId?: string } | undefined)?.postId)?.data as
      | { postId?: string }
      | undefined)?.postId ??
    null;
  // Concept selection gate data: the 3-5 versions + current pick, and whether a media step runs
  // downstream (decides if an uploaded image conditions generation vs becomes the media itself).
  const conceptGateData = run.artifacts.find((a) => a.type === 'content_concept')?.data as
    | { variants?: Array<{ body: string; threads: string; x: string }>; chosen?: number }
    | undefined;
  const conceptVariants = conceptGateData?.variants ?? [];
  const conceptChosen = conceptGateData?.chosen ?? 0;
  const hasMediaStep = run.nodes.some(
    (n) => (n.agentId === 'infographic' || n.agentId === 'storyboard') && n.status !== 'skipped',
  );
  const publishArtifact = run.artifacts.find((a) => a.type === 'publish_result');
  const publishUrls = (publishArtifact?.data as { postUrls?: Record<string, string> | null } | undefined)?.postUrls ?? null;
  const requiredActions = run.requiredActions ?? [];
  // needs_connection with cards handled by the ConnectionRequired block (its own continue
  // re-resolves). requiredActions only rides the POST /execute response — a reloaded gated
  // run (GET) has none, so keep Execute available there to re-run the resolver server-side.
  const canExecute =
    run.status === 'planned' || run.status === 'failed' ||
    (run.status === 'needs_connection' && requiredActions.length === 0);
  // A `planned` run with some steps already completed is a RESUMED run (after a single-step
  // re-run): the button continues from the stale downstream rather than starting fresh.
  const isResume = run.status === 'planned' && run.nodes.some((n) => n.status === 'completed') && run.nodes.some((n) => n.status === 'pending');

  const selectedNodeRun = selectedNode ? run.nodes.find((n) => n.nodeId === selectedNode) : null;
  const selectedArtifact = selectedNode ? run.artifacts.find((a) => a.nodeId === selectedNode) : null;
  const selectedView = selectedArtifact ? formatArtifact(selectedArtifact.type, selectedArtifact.data) : null;
  // The concept_writer artifact carries the editable copy + its postId (edit/refine target).
  const conceptData = selectedArtifact?.type === 'content_concept'
    ? (selectedArtifact.data as { copy?: Copy; postId?: string } | undefined)
    : undefined;
  const conceptPostId = conceptData?.postId ?? null;
  const conceptCopy = conceptData?.copy ?? null;
  // Show the version picker (review mode) when the concept step is selected and produced
  // multiple versions, unless the live needs_approval gate is already rendering it.
  const liveConceptGate = run.status === 'needs_approval' && gateNode?.agentId === 'concept_writer';
  const showConceptReview = Boolean(
    !liveConceptGate && selectedNodeRun?.agentId === 'concept_writer' && conceptVariants.length > 1 && runPostId,
  );
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
            {busy ? 'Starting…' : isResume ? '▶ Continue (run stale steps)' : run.status === 'failed' ? '↻ Re-run flow' : run.status === 'needs_connection' ? 'Check connection & run' : '▶ Execute'}
          </button>
        )}
      </div>
      <p className="muted small">{isResume ? 'A step was re-run — later steps are stale. Click Continue to regenerate them, then approve to publish.' : statusHint}</p>

      <div className="post-workflow-body">
        <RunDagView nodes={run.nodes} publishUrls={publishUrls} platforms={(run.goal as { platforms?: string[] } | null)?.platforms ?? []} onSelectNode={setSelectedNode} selectedNodeId={selectedNode} notices={notices} />

        {run.status === 'needs_connection' && requiredActions.length > 0 && (
          <ConnectionRequired actions={requiredActions} busy={busy} onContinue={() => void execute()} onOpenConnections={onOpenConnections} />
        )}

        {/* Reloaded gated run (GET carries no requiredActions): still surface a route to
            the Connections page so the user isn't stranded with just "Check connection". */}
        {run.status === 'needs_connection' && requiredActions.length === 0 && onOpenConnections && (
          <div className="gate-block">
            <p className="muted small">A platform needs connecting before this can publish.</p>
            <button className="btn primary small" onClick={onOpenConnections}>🔌 Go to Connections</button>
          </div>
        )}

        {/* Concept selection gate: pick a version + optional reference image, then Continue. */}
        {run.status === 'needs_approval' && gateNode?.agentId === 'concept_writer' && runPostId && conceptVariants.length > 0 && (
          <ConceptSelectionGate
            postId={runPostId}
            variants={conceptVariants}
            chosen={conceptChosen}
            hasMediaStep={hasMediaStep}
            busy={busy}
            onContinue={() => void approveNode(gateNode.nodeId)}
            notify={notify}
          />
        )}

        {run.status === 'needs_approval' && gateNode && gateNode.agentId !== 'concept_writer' && (
          <div className="gate-block">
            {gateNode.agentId === 'video' ? (
              <>
                <p className="muted small">Storyboard ready — <strong>review the frames above</strong>. Video generation is the costly step, so it waits for your OK. Not happy with a frame? Re-run the storyboard first, then approve.</p>
                <button className="btn primary" disabled={busy} onClick={() => void approveNode(gateNode.nodeId)}>
                  {busy ? 'Starting…' : '▶ Approve — generate video'}
                </button>
              </>
            ) : (
              <>
                <p className="muted small">Paused before <strong>{gateNode.agentId.replace(/_/g, ' ')}</strong> — an external action. Review where it can post, then approve.</p>
                {gateNode.agentId === 'publisher' && runPostId && (
                  <PublishReview postId={runPostId} onOpenConnections={onOpenConnections} />
                )}
                <button className="btn primary" disabled={busy} onClick={() => void approveNode(gateNode.nodeId)}>
                  {busy ? 'Publishing…' : `Approve ${gateNode.agentId.replace(/_/g, ' ')}`}
                </button>
              </>
            )}
          </div>
        )}

        {/* REVIEW versions on a completed concept step (e.g. after a re-run parked the run):
            the picker vanishing made users think versions were lost — show them here so they
            can review/re-pick. Suppressed while the live needs_approval gate is already showing. */}
        {showConceptReview && (
          <ConceptSelectionGate
            postId={runPostId!}
            variants={conceptVariants}
            chosen={conceptChosen}
            hasMediaStep={hasMediaStep}
            busy={busy}
            notify={notify}
          />
        )}

        {selectedNode && !showConceptReview && (
          <div className="artifact-view">
            {selectedView ? (
              <>
                <div className="section-title">{selectedView.title}</div>
                {selectedView.imageUrl && (
                  <img className="artifact-image" src={selectedView.imageUrl} alt={selectedView.title} loading="lazy" />
                )}
                {selectedView.videoUrl && (
                  <video className="artifact-video" src={selectedView.videoUrl} controls preload="metadata" />
                )}
                {selectedView.imageUrls && selectedView.imageUrls.length > 0 && (
                  <div className="artifact-gallery">
                    {selectedView.imageUrls.map((u, i) => (
                      <img className="artifact-frame" src={u} alt={`${selectedView.title} frame ${i + 1}`} key={u} loading="lazy" />
                    ))}
                  </div>
                )}
                {selectedView.fields.map((f) => (
                  <div className="artifact-field" key={f.label}><strong>{f.label}</strong><p>{f.value}</p></div>
                ))}
                {selectedView.fields.length === 0 && !selectedView.imageUrl && !selectedView.videoUrl && (!selectedView.imageUrls || selectedView.imageUrls.length === 0) && <p className="muted small">No output yet for this step.</p>}
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

            {/* Concept copy: edit by hand (no LLM) OR refine via instruction (LLM). */}
            {conceptCopy && conceptPostId && run.status !== 'running' && (
              <div className="copy-edit-row">
                {!editCopy && !refineOpen && (
                  <div className="btn-row">
                    <button className="btn small" disabled={busy} onClick={() => setEditCopy({ ...conceptCopy })}>✎ Edit copy</button>
                    <button className="btn small" disabled={busy} onClick={() => setRefineOpen(true)}>✨ Refine with AI</button>
                  </div>
                )}
                {editCopy && (
                  <div className="copy-editor">
                    <label>Body</label>
                    <textarea rows={4} value={editCopy.body} onChange={(e) => setEditCopy({ ...editCopy, body: e.target.value })} />
                    <label>Threads</label>
                    <textarea rows={2} value={editCopy.threads} onChange={(e) => setEditCopy({ ...editCopy, threads: e.target.value })} />
                    <label>X</label>
                    <textarea rows={2} value={editCopy.x} onChange={(e) => setEditCopy({ ...editCopy, x: e.target.value })} />
                    <div className="btn-row">
                      <button className="btn small primary" disabled={busy} onClick={() => void saveCopy(conceptPostId)}>{busy ? 'Saving…' : 'Save copy'}</button>
                      <button className="btn small" disabled={busy} onClick={() => setEditCopy(null)}>Cancel</button>
                    </div>
                  </div>
                )}
                {refineOpen && (
                  <div className="copy-editor">
                    <label>Refine instruction</label>
                    <textarea rows={3} autoFocus value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="e.g. shorten the hook, add a discount mention, make the tone warmer…" />
                    <div className="btn-row">
                      <button className="btn small primary" disabled={busy || !refineText.trim()} onClick={() => void refineCopy(conceptPostId)}>{busy ? 'Refining…' : 'Refine'}</button>
                      <button className="btn small" disabled={busy} onClick={() => { setRefineOpen(false); setRefineText(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
