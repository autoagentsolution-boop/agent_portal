// Workspace room — the Command Center's inline right panel (Atria v2 P1). Renders a workspace's
// dashboard (status counts + cost-by-agent cards) over the P0 view-model, live-updating via SSE +
// a poll fallback. Drilling into a post reuses the existing PostWorkflowView (SSE timeline, output,
// re-run node, edit-copy, publish gate) — no re-implementation of per-agent controls. Rendered in
// the light-themed drawer (.cc-drawer) so the embedded post view keeps its native styling.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type WorkspaceDetailDto, type DerivedPostStatus } from '../api/client';
import { useWorkspaceEvents } from '../hooks/use-workspace-events';
import { PostWorkflowView } from './post-workflow-view';

interface Props {
  campaignId: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onOpenConnections?: () => void;
  // P2.6 — "Open full board": jump from this dashboard drawer to the deep board (PostBoard + DAG).
  onOpenBoard?: () => void;
}

const DOT: Record<DerivedPostStatus, { color: string; label: string }> = {
  planned: { color: 'var(--muted)', label: 'Planned' },
  running: { color: 'var(--blue)', label: 'Running' },
  held: { color: 'var(--amber)', label: 'Needs you' },
  posted: { color: 'var(--green)', label: 'Posted' },
  failed: { color: 'var(--red)', label: 'Failed' },
};
const ORDER: DerivedPostStatus[] = ['planned', 'running', 'held', 'posted', 'failed'];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'unscheduled');
const fmtCredits = (n: number) => Math.round(n).toLocaleString();

export function WorkspacePanel({ campaignId, notify, onOpenConnections, onOpenBoard }: Props) {
  const [ws, setWs] = useState<WorkspaceDetailDto | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  // Per-post autonomy grant (2-step): clicking a planned post's "Chuẩn bị" fetches the cost (Step 1)
  // into `grantFor`; confirming echoes the token (Step 2) so the autonomy runner prepares it.
  const [grantFor, setGrantFor] = useState<{ postId: string; credits: number; token: string } | null>(null);
  const [granting, setGranting] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  // Step 1 — surface this post's cost + hold the confirmation token (nothing granted yet).
  const startGrant = async (postId: string) => {
    setGranting(true);
    try {
      const r = await api.grantPost(postId);
      if (!r.ok) { notify(`Grant: ${r.error.error}`, 'err'); return; }
      setGrantFor({ postId, credits: Math.round(r.data.estimate.credits), token: r.data.confirmationToken ?? '' });
    } finally { setGranting(false); }
  };
  // Step 2 — confirm: grant the run to 'atria'; the autonomy cron then prepares it (parks at review).
  const confirmGrant = async () => {
    if (!grantFor) return;
    setGranting(true);
    try {
      const r = await api.grantPost(grantFor.postId, { confirmationToken: grantFor.token, scheduleConfirmed: true });
      if (!r.ok) { notify(`Grant: ${r.error.error}`, 'err'); return; }
      notify('Autonomy granted — Atria will prepare and auto-publish on schedule.');
      setGrantFor(null);
      void load();
    } finally { setGranting(false); }
  };

  const load = useCallback(async () => {
    const r = await api.getWorkspace(campaignId);
    if (r.ok) setWs(r.data);
    else notify(`Workspace: ${r.error.error}`, 'err');
  }, [campaignId, notify]);

  // New workspace selected → reset drill + fetch. Poll fallback covers missed/duplicate SSE frames.
  useEffect(() => {
    setOpenRunId(null);
    void load();
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [campaignId, load]);

  // SSE: coalesce bursty node.status frames into one refetch (~600ms) so a fast-advancing run
  // doesn't hammer the endpoint.
  const runIds = ws?.posts.map((p) => p.runId) ?? [];
  const onChange = useCallback(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void load(), 600);
  }, [load]);
  const live = useWorkspaceEvents(campaignId, runIds, onChange);
  useEffect(() => () => window.clearTimeout(debounce.current), []);

  if (!ws) return <div className="cc-drawer-body"><p className="muted">Loading workspace…</p></div>;

  if (openRunId) {
    return (
      <div className="cc-drawer-body">
        <button className="cc-drawer-back" onClick={() => setOpenRunId(null)}>← {ws.name}</button>
        <PostWorkflowView runId={openRunId} notify={notify} onOpenConnections={onOpenConnections} />
      </div>
    );
  }

  return (
    <div className="cc-drawer-body">
      <div className="ws-panel-head">
        <div>
          <h3>{ws.name}</h3>
          <span className="muted">{ws.postCount} post{ws.postCount === 1 ? '' : 's'} · {ws.platforms.join(', ') || 'no platforms'}</span>
        </div>
        <div className="ws-head-right">
          <span className="ws-cost" title="Total credits spent by this workspace">
            ◈ {fmtCredits(ws.credits)} cr {live && <span className="ws-live" title="Live">●</span>}
          </span>
          {onOpenBoard && (
            <button className="ws-open-board" onClick={onOpenBoard} title="Mở board đầy đủ (posts + DAG)">▦ Mở board</button>
          )}
        </div>
      </div>

      <div className="ws-status-row">
        {ORDER.filter((k) => ws.counts[k] > 0).map((k) => (
          <span className="ws-status-chip" key={k}>
            <span className="ws-dot" style={{ background: DOT[k].color }} />
            {DOT[k].label} <strong>{ws.counts[k]}</strong>
          </span>
        ))}
        {ws.postCount === 0 && <span className="muted">No posts yet — approve a calendar to populate this workspace.</span>}
      </div>

      {ws.agents.length > 0 && (
        <>
          <div className="ws-section-title">Cost by agent</div>
          <div className="ws-agent-grid">
            {ws.agents.map((a) => (
              <div className="ws-agent-card" key={a.agentId} title={`${a.runs} run(s) · ${a.completed} done · ${a.running} running · ${a.failed} failed`}>
                <span className="ws-agent-emoji">{a.emoji}</span>
                <div className="ws-agent-body">
                  <strong>{a.name.replace(/ Agent$/, '')}</strong>
                  <span className="muted">◈ {fmtCredits(a.credits)} cr</span>
                </div>
                <span className="ws-agent-runs">
                  {a.failed > 0 && <span style={{ color: DOT.failed.color }}>{a.failed}✕</span>}
                  {a.running > 0 && <span style={{ color: DOT.running.color }}>{a.running}⟳</span>}
                  {a.completed}/{a.runs}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {ws.posts.length > 0 && (
        <>
          <div className="ws-section-title">Posts</div>
          <ul className="ws-post-list">
            {ws.posts.map((p) => (
              <li key={p.postId} className="ws-post-li">
                <button className="ws-post-row" onClick={() => setOpenRunId(p.runId)}>
                  <span className="ws-dot" style={{ background: DOT[p.status].color }} title={DOT[p.status].label} />
                  <span className="ws-post-when">{when(p.scheduledAt)}</span>
                  <span className="muted">{DOT[p.status].label}</span>
                  <span className="ws-post-open">Open →</span>
                </button>
                {/* A not-yet-run (planned/brief) post can be granted so Atria auto-prepares it. */}
                {p.status === 'planned' && (
                  grantFor?.postId === p.postId ? (
                    <span className="ws-grant-confirm">
                      ≈ {grantFor.credits.toLocaleString()} cr?
                      <button className="ws-grant-yes" disabled={granting} onClick={() => void confirmGrant()}>Confirm</button>
                      <button className="ws-grant-no" disabled={granting} onClick={() => setGrantFor(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      className="ws-grant-btn"
                      disabled={granting}
                      title="Grant Atria autonomy to run the steps and auto-publish on schedule"
                      onClick={() => void startGrant(p.postId)}
                    >⚡ Prepare</button>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
