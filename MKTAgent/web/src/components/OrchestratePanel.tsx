// Orchestrate panel — the M1 goal-based Master Agent surface (distinct from the
// legacy /agent template chat). Drives the full lifecycle over /orchestration:
//   type a goal → clarification questions (chips) → DAG preview → approve →
//   approve the publish gate. Shows node statuses live as the executor advances.
import { useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

type Question = NonNullable<WorkflowRunDto['questions']>[number];

const STATUS_LABEL: Record<string, string> = {
  awaiting_clarification: 'Needs a few details',
  planned: 'Plan ready — review & approve',
  running: 'Running…',
  needs_approval: 'Awaiting your approval to publish',
  completed: 'Completed',
  failed: 'Failed',
};

const NODE_DOT: Record<string, string> = {
  pending: '○', running: '◐', awaiting_approval: '⏸', completed: '●', failed: '✕', skipped: '–',
};

export function OrchestratePanel({ notify }: Props) {
  const [input, setInput] = useState('');
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);

  const apply = (r: { ok: true; data: WorkflowRunDto } | { ok: false; error: { error: string } }, okMsg?: string) => {
    if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
    setRun(r.data);
    if (okMsg) notify(okMsg);
  };

  const start = async () => {
    if (input.trim().length < 3) { notify('Describe your goal first', 'err'); return; }
    setBusy(true); setAnswers({});
    apply(await api.createRun(input.trim()));
    setBusy(false);
  };

  const submitAnswers = async () => {
    if (!run) return;
    setBusy(true);
    apply(await api.clarifyRun(run.id, answers));
    setAnswers({});
    setBusy(false);
  };

  const approve = async () => {
    if (!run) return;
    setBusy(true);
    apply(await api.approveRun(run.id), 'Workflow executing…');
    setBusy(false);
  };

  const approveNode = async (nodeId: string) => {
    if (!run) return;
    setBusy(true);
    apply(await api.approveRunNode(run.id, nodeId), 'Publishing…');
    setBusy(false);
  };

  const setAnswer = (slot: string, value: string | string[]) => setAnswers((a) => ({ ...a, [slot]: value }));

  const toggleMulti = (slot: string, choice: string) => {
    const cur = (answers[slot] as string[] | undefined) ?? [];
    setAnswer(slot, cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice]);
  };

  const gateNode = run?.nodes.find((n) => n.status === 'awaiting_approval');

  return (
    <section className="orchestrate-panel">
      <div className="orchestrate-head">
        <h2>Master Agent · Goal Orchestration</h2>
        <p className="muted small">
          Describe what you want. The agent extracts intent, asks only what's missing, plans a dynamic
          workflow, and runs it step-by-step — pausing for your approval before anything is published.
        </p>
      </div>

      <div className="orchestrate-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Post about our AI automation course on Facebook and LinkedIn with an infographic"
        />
        <button className="btn primary" disabled={busy} onClick={() => void start()}>
          {busy && !run ? 'Thinking…' : 'Plan workflow'}
        </button>
      </div>

      {run && (
        <div className="orchestrate-run">
          <div className="run-status-row">
            <span className={`run-badge st-${run.status}`}>{STATUS_LABEL[run.status] ?? run.status}</span>
          </div>

          {/* Clarification */}
          {run.status === 'awaiting_clarification' && run.questions && (
            <div className="clarify-block">
              {run.questions.map((q: Question) => (
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
                            onClick={() => (q.multiSelect ? toggleMulti(q.slot, c) : setAnswer(q.slot, c))}
                          >{c}</button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      value={(answers[q.slot] as string) ?? ''}
                      onChange={(e) => setAnswer(q.slot, e.target.value)}
                      placeholder="Type your answer"
                    />
                  )}
                </div>
              ))}
              <button className="btn primary" disabled={busy} onClick={() => void submitAnswers()}>
                {busy ? 'Re-planning…' : 'Submit answers'}
              </button>
            </div>
          )}

          {/* DAG preview + node states */}
          {run.nodes.length > 0 && (
            <div className="dag-block">
              <div className="eyebrow">Workflow plan</div>
              <ol className="dag-list">
                {run.nodes.map((n) => (
                  <li key={n.nodeId} className={`dag-node st-${n.status}`}>
                    <span className="dag-dot">{NODE_DOT[n.status] ?? '○'}</span>
                    <span className="dag-agent">{n.agentId.replace(/_/g, ' ')}</span>
                    {n.dependsOn.length > 0 && <span className="dag-dep">after {n.dependsOn.join(', ')}</span>}
                    {n.error && <span className="dag-err">{n.error}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Approve to run */}
          {run.status === 'planned' && (
            <button className="btn primary" disabled={busy} onClick={() => void approve()}>
              {busy ? 'Starting…' : 'Approve & run workflow'}
            </button>
          )}

          {/* Publish gate */}
          {run.status === 'needs_approval' && gateNode && (
            <div className="gate-block">
              <p className="muted small">The workflow paused before <strong>{gateNode.agentId.replace(/_/g, ' ')}</strong> — an external action. Approve to proceed.</p>
              <button className="btn primary" disabled={busy} onClick={() => void approveNode(gateNode.nodeId)}>
                {busy ? 'Publishing…' : `Approve ${gateNode.agentId.replace(/_/g, ' ')}`}
              </button>
            </div>
          )}

          {/* Artifacts */}
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

          <button className="btn ghost" onClick={() => { setRun(null); setInput(''); setAnswers({}); }}>New goal</button>
        </div>
      )}
    </section>
  );
}
