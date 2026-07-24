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
import { VideoScriptReview, type VideoScript } from './video-script-review.tsx';
import { PublishReview } from './publish-review';
import { ConceptSelectionGate } from './concept-selection-gate';
import { ConceptCopyEditor, type Copy } from './concept-copy-editor';
import { formatArtifact } from '../flow/artifact-format';
import { useLocale, type MessageKey } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  runId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onOpenConnections?: () => void;
}

const STATUS_HINT_KEY: Record<string, MessageKey> = {
  planned: 'workflow.hint.planned',
  running: 'workflow.hint.running',
  needs_approval: 'workflow.hint.needs_approval',
  needs_connection: 'workflow.hint.needs_connection',
  completed: 'workflow.hint.completed',
  failed: 'workflow.hint.failed',
  scheduled: 'workflow.hint.scheduled',
  cancelled: 'workflow.hint.cancelled',
};

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
  const { t } = useLocale();
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Live per-node hold notices (nodeId → text) from node.status SSE events — not persisted
  // on the run DTO, so kept separately and reset whenever we switch/reload the run.
  const [notices, setNotices] = useState<Record<string, string>>({});
  // Publish-gate schedule (Fix A): empty → publish now; a future time → park ready, scheduler fires it.
  const [publishAt, setPublishAt] = useState('');
  // Per-post autonomy grant ("⚡ Chuẩn bị", G1): 2-step like the Scheduled/Workspace renderers —
  // Step 1 surfaces the credit forecast + a token; Step 2 hands the run to Atria (approvalMode→atria).
  const [grantPending, setGrantPending] = useState<{ credits: number; token: string } | null>(null);
  const [granting, setGranting] = useState(false);
  // Watchdog (F3): if a granted run sits in "preparing" too long (autonomy cron off/behind), stop
  // pretending Atria is on it — reveal manual Execute + a hint so the post isn't a silent dead-end.
  const [stalled, setStalled] = useState(false);

  const load = async () => {
    const r = await api.getRun(runId);
    if (r.ok) setRun(r.data);
    else notify(tError(r.error), 'err');
  };
  useEffect(() => { setRun(null); setSelectedNode(null); setNotices({}); void load(); }, [runId]);

  const liveId = run && (run.status === 'running' || run.status === 'needs_approval') ? run.id : null;
  useRunEvents(liveId, (ev) => {
    setRun((cur) => cur && cur.id === ev.runId
      ? { ...cur, nodes: cur.nodes.map((n) => n.nodeId === ev.nodeId ? { ...n, status: ev.status, error: ev.error ?? n.error } : n) }
      : cur);
    if (ev.notice) setNotices((prev) => ({ ...prev, [ev.nodeId]: ev.notice! }));
    // Reload the run DTO whenever a node reaches a TERMINAL or PARK state — not just completed/failed.
    // A node that parks `awaiting_approval` (a gate: concept selection, video cost, OR the publisher
    // connection re-gate from the gate-after-content change) transitions the RUN to needs_approval/
    // needs_connection. Without refetching, run.status stays optimistically 'running' → the view shows
    // "Running…" forever and hides the review affordances (edit/refine copy, re-run, connect prompt).
    if (ev.status === 'completed' || ev.status === 'failed' || ev.status === 'awaiting_approval') void load();
  });

  // Atria-granted run left `planned`/`running` is being auto-prepared by the autonomy cron (≤2 min
  // cadence). SSE only connects once status is running/needs_approval, so poll while it "prepares"
  // to advance the view when the cron claims it and again when it parks at review.
  const preparing = run?.approvalMode === 'atria' && (run.status === 'planned' || run.status === 'running');
  useEffect(() => {
    if (!preparing) { setStalled(false); return; }
    const poll = setInterval(() => void load(), 8000);
    // No progress after ~32s → assume the autonomy cron isn't running; surface manual control.
    const watchdog = setTimeout(() => setStalled(true), 32000);
    return () => { clearInterval(poll); clearTimeout(watchdog); };
  }, [preparing, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const execute = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) {
        if (r.error.status === 402) { notify(t('credits.exhausted'), 'err'); return; }
        notify(tError(r.error), 'err'); return;
      }
      // Only optimistically show running when the run actually started (not gated to
      // needs_connection, where no node runs yet).
      setRun(r.data.status === 'running' ? markRunning(r.data, nextRunnableNodeId(r.data.nodes)) : r.data);
      notify(t('workflow.executing.notice'));
    } finally { setBusy(false); }
  };

  const approveNode = async (nodeId: string, scheduledAt?: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.approveRunNode(run.id, nodeId, scheduledAt);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      setRun(r.data); notify(scheduledAt ? t('post.scheduled_for', { time: new Date(scheduledAt).toLocaleString() }) : t('publish.publishing.notice'));
    } finally { setBusy(false); }
  };

  const rerun = async (nodeId: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.rerunRunNode(run.id, nodeId);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      // rerun-node launches the executor on exactly this node and returns status=running;
      // show it running immediately (the response still carries the reset pending node).
      setRun(markRunning(r.data, nodeId));
      notify(t('step.rerun.notice'));
    } finally { setBusy(false); }
  };

  // Step 1 — fetch this post's forecast + token (does NOT grant yet).
  const startGrant = async (postId: string) => {
    setGranting(true);
    try {
      const r = await api.grantPost(postId);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      setGrantPending({ credits: Math.round(r.data.estimate.credits), token: r.data.confirmationToken ?? '' });
    } finally { setGranting(false); }
  };
  // Step 2 — confirm: flip the run to atria autonomy. The cron then prepares it + parks at review.
  const confirmGrant = async (postId: string) => {
    if (!grantPending) return;
    setGranting(true);
    try {
      const r = await api.grantPost(postId, { confirmationToken: grantPending.token, scheduleConfirmed: true });
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      setGrantPending(null);
      notify(t('autonomy.grant.notice'));
      await load();
    } finally { setGranting(false); }
  };

  if (!run) return <div className="post-workflow"><p className="muted small">Loading workflow…</p></div>;

  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  // The needs_approval hint depends on WHICH gate we're at — the video cost-gate reads
  // differently from the publisher external-write gate.
  const statusHintKey = STATUS_HINT_KEY[run.status];
  const statusHint = run.status === 'needs_approval' && gateNode?.agentId === 'video'
    ? t('workflow.hint.video_gate')
    : run.status === 'needs_approval' && gateNode?.agentId === 'concept_writer'
      ? t('workflow.hint.concept_gate')
      : statusHintKey ? t(statusHintKey) : run.status;
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
  // The script the video gate asks the user to approve (see VideoScriptReview).
  const videoScript = run.artifacts.find((a) => a.type === 'video_script')?.data as VideoScript | undefined;
  const publishUrls = (publishArtifact?.data as { postUrls?: Record<string, string> | null } | undefined)?.postUrls ?? null;
  const requiredActions = run.requiredActions ?? [];
  // needs_connection with cards handled by the ConnectionRequired block (its own continue
  // re-resolves). requiredActions only rides the POST /execute response — a reloaded gated
  // run (GET) has none, so keep Execute available there to re-run the resolver server-side.
  // An atria-granted run is driven by the autonomy cron, not the manual Execute button. Suppress
  // Execute/grant only WHILE it is actively being prepared (planned/running) and the watchdog hasn't
  // tripped. On an errored/parked atria run — failed, needs_connection, or a stalled prepare — the cron
  // won't re-claim it (it claims only `planned`), so restore Execute so the operator can take over
  // instead of a dead-ended post (F2/F3).
  const isAtriaGranted = run.approvalMode === 'atria';
  const atriaDriving = isAtriaGranted && !stalled && (run.status === 'planned' || run.status === 'running');
  const canExecute = !atriaDriving && (
    run.status === 'planned' || run.status === 'failed' ||
    (run.status === 'needs_connection' && requiredActions.length === 0));
  // Offer the grant ("⚡ Chuẩn bị") only on a fresh planned campaign post that still runs manually.
  // The grant endpoint 409s (`not_a_campaign_post`) on a standalone post, so require a campaignId.
  const canGrant = !isAtriaGranted && run.status === 'planned' && Boolean(runPostId) && Boolean(run.campaignId);
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
            {busy ? t('workflow.execute.starting') : isResume ? t('workflow.execute.continue') : run.status === 'failed' ? t('workflow.execute.rerun_flow_icon') : run.status === 'needs_connection' ? t('workflow.execute.check_connection') : t('workflow.execute.cta')}
          </button>
        )}
        {canGrant && (
          grantPending ? (
            <span className="ws-grant-confirm">
              {t('credits.grant.inline', { credits: grantPending.credits.toLocaleString() })}
              <button className="ws-grant-yes" disabled={granting} onClick={() => void confirmGrant(runPostId!)}>{t('common.confirm')}</button>
              <button className="ws-grant-no" disabled={granting} onClick={() => setGrantPending(null)}>{t('common.cancel')}</button>
            </span>
          ) : (
            <button className="btn small" disabled={granting} title={t('autonomy.grant.title.post')} onClick={() => void startGrant(runPostId!)}>
              {granting ? t('autonomy.grant.calculating') : t('autonomy.grant.cta')}
            </button>
          )
        )}
      </div>
      {preparing && !stalled ? (
        <div className="atria-preparing" role="status" aria-live="polite">
          <span className="atria-preparing-dot" aria-hidden="true" />
          {t('autonomy.preparing.active')}
        </div>
      ) : preparing && stalled ? (
        <div className="atria-preparing is-stalled" role="status" aria-live="polite">
          <span className="atria-preparing-dot" aria-hidden="true" />
          {t('autonomy.preparing.stalled')}
        </div>
      ) : (
        <p className="muted small">{isResume ? t('workflow.resume.hint') : statusHint}</p>
      )}

      <div className="post-workflow-body">
        <RunDagView nodes={run.nodes} publishUrls={publishUrls} platforms={(run.goal as { platforms?: string[] } | null)?.platforms ?? []} onSelectNode={setSelectedNode} selectedNodeId={selectedNode} notices={notices} scheduledResumeAt={run.scheduledResumeAt} />

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

        {/* campaign_strategist never gates under a Post (it runs under a flow), but exclude it here so a
            stray strategist gate can't render as a mislabeled "external action". */}
        {run.status === 'needs_approval' && gateNode && gateNode.agentId !== 'concept_writer' && gateNode.agentId !== 'campaign_strategist' && (
          <div className="gate-block">
            {gateNode.agentId === 'video' ? (
              <>
                {/* The script, not frames: video renders FROM video_script now, so nothing has been
                    generated yet at this gate. Showing the shots is what makes the spend reviewable. */}
                {videoScript ? (
                  <>
                    <VideoScriptReview script={videoScript} requestedSec={(run.goal as { slots?: { videoLengthSec?: number | null } } | null)?.slots?.videoLengthSec ?? null} />
                    <p className="muted small">{t('video.gate.review_hint')}</p>
                  </>
                ) : (
                  <p className="muted small">{t('video.gate.ready_hint')}</p>
                )}
                <button className="btn primary" disabled={busy} onClick={() => void approveNode(gateNode.nodeId)}>
                  {busy ? t('workflow.execute.starting') : t('video.approve.cta')}
                </button>
              </>
            ) : (
              <>
                <p className="muted small">{t('gate.external.review_approve', { agent: gateNode.agentId.replace(/_/g, ' ') })}</p>
                {gateNode.agentId === 'publisher' && runPostId && (
                  <PublishReview postId={runPostId} onOpenConnections={onOpenConnections} />
                )}
                {gateNode.agentId === 'publisher' && (
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>{t('schedule.optional.label')}</label>
                    <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
                    <div className="help-text">{t('schedule.optional.help')}</div>
                  </div>
                )}
                <button className="btn primary" disabled={busy} onClick={() => void approveNode(gateNode.nodeId, gateNode.agentId === 'publisher' && publishAt ? new Date(publishAt).toISOString() : undefined)}>
                  {busy ? t('publish.publishing.notice') : gateNode.agentId === 'publisher' && publishAt ? t('publish.approve_schedule.cta') : t('publish.approve_agent.cta', { agent: gateNode.agentId.replace(/_/g, ' ') })}
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
                  {busy ? t('step.rerun.busy') : t('step.rerun.cta')}
                </button>
                <span className="muted small">{t('step.rerun.help')}</span>
              </div>
            )}

            {/* Concept copy: edit by hand (no LLM) OR refine via instruction (LLM). */}
            {conceptCopy && conceptPostId && run.status !== 'running' && (
              <ConceptCopyEditor postId={conceptPostId} copy={conceptCopy} busy={busy} notify={notify} onSaved={() => void load()} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
