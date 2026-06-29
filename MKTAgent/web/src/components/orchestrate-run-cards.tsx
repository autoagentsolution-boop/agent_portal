// Presentational in-chat cards for the Orchestrate surface. The conversational
// assistant bubble introduces these; they render the structured side of the turn —
// clarification questions, the planned DAG, the publish gate, raw artifacts. Pure UI
// (no fetching) so the chat shell (OrchestratePanel) owns all state + side effects.
import type { WorkflowRunDto } from '../api/client';

type Question = NonNullable<WorkflowRunDto['questions']>[number];

const NODE_DOT: Record<string, string> = {
  pending: '○', running: '◐', awaiting_approval: '⏸', completed: '●', failed: '✕', skipped: '–',
};

interface ClarifyProps {
  questions: Question[];
  answers: Record<string, string | string[]>;
  busy: boolean;
  onAnswer: (slot: string, value: string | string[]) => void;
  onToggleMulti: (slot: string, choice: string) => void;
  onSubmit: () => void;
}

export function ClarifyCard({ questions, answers, busy, onAnswer, onToggleMulti, onSubmit }: ClarifyProps) {
  return (
    <div className="clarify-block run-card">
      {questions.map((q) => (
        <div className="clarify-q" key={q.slot}>
          <label>{q.question}{q.required && <span className="req"> *</span>}</label>
          {q.choices ? (
            <div className="chip-row">
              {q.choices.map((c) => {
                const active = q.multiSelect
                  ? ((answers[q.slot] as string[] | undefined) ?? []).includes(c)
                  : answers[q.slot] === c;
                return (
                  <button
                    key={c}
                    className={`chip ${active ? 'active' : ''}`}
                    onClick={() => (q.multiSelect ? onToggleMulti(q.slot, c) : onAnswer(q.slot, c))}
                  >{c}</button>
                );
              })}
            </div>
          ) : (
            <input
              value={(answers[q.slot] as string) ?? ''}
              onChange={(e) => onAnswer(q.slot, e.target.value)}
              placeholder="Type your answer"
            />
          )}
        </div>
      ))}
      <button className="btn primary" disabled={busy} onClick={onSubmit}>
        {busy ? 'Re-planning…' : 'Submit answers'}
      </button>
    </div>
  );
}

interface PlanProps {
  run: WorkflowRunDto;
  busy: boolean;
  onApprove: () => void;
  onApproveNode: (nodeId: string) => void;
}

export function PlanCard({ run, busy, onApprove, onApproveNode }: PlanProps) {
  const gateNode = run.nodes.find((n) => n.status === 'awaiting_approval');
  const publishArtifact = run.artifacts.find((a) => a.type === 'publish_result');
  const publishData = publishArtifact?.data as { postUrls?: Record<string, string> | null } | undefined;
  const platformRows = Object.entries(publishData?.postUrls ?? {});

  return (
    <div className="dag-block run-card">
      <div className="eyebrow">Workflow plan · {run.nodes.length} step(s)</div>
      <ol className="dag-list">
        {run.nodes.map((n) => (
          <li key={n.nodeId} className={`dag-node st-${n.status}`}>
            <span className="dag-dot">{NODE_DOT[n.status] ?? '○'}</span>
            <span className="dag-agent">{n.agentId.replace(/_/g, ' ')}</span>
            {n.dependsOn.length > 0 && <span className="dag-dep">after {n.dependsOn.join(', ')}</span>}
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
          </li>
        ))}
      </ol>

      {run.status === 'planned' && (
        <button className="btn primary" disabled={busy} onClick={onApprove}>
          {busy ? 'Starting…' : 'Approve & run workflow'}
        </button>
      )}

      {run.status === 'needs_approval' && gateNode && (
        <div className="gate-block">
          <p className="muted small">Paused before <strong>{gateNode.agentId.replace(/_/g, ' ')}</strong> — an external action. Approve to proceed.</p>
          <button className="btn primary" disabled={busy} onClick={() => onApproveNode(gateNode.nodeId)}>
            {busy ? 'Publishing…' : `Approve ${gateNode.agentId.replace(/_/g, ' ')}`}
          </button>
        </div>
      )}

      {run.artifacts.length > 0 && (
        <details className="artifacts-block">
          <summary>{run.artifacts.length} artifact(s)</summary>
          {run.artifacts.map((a) => (
            <div className="artifact-row" key={a.id}>
              <span className="artifact-type">{a.type}</span>
              <pre>{JSON.stringify(a.data, null, 2).slice(0, 600)}</pre>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
