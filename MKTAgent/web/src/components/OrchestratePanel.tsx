// Orchestrate panel — the M1 goal-based Master Agent as a CONVERSATIONAL surface
// (was a form; brought up to the legacy MasterAgentIntake bar). One unified chat:
// the user types a goal, the agent restates intent + asks the high-impact missing
// questions, then presents the planned DAG as an in-chat card with approve/publish
// gates. Reuses the legacy chat-bubble / thinking-bubble / floating-composer markup +
// CSS. Runs persist to a chat session, so they live in the sidebar and restore.
import { useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';
import { useRunEvents } from '../hooks/use-run-events';
import { ClarifyCard, PlanCard } from './orchestrate-run-cards';

export interface OrchestrateRestore {
  sessionId: string;
  messages: Array<{ role: 'user' | 'agent'; content: string }>;
  run: WorkflowRunDto | null;
}

interface Props {
  restore: OrchestrateRestore | null;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onRunActivity: (sessionId: string) => void;
}

interface Msg { role: 'user' | 'agent'; content: string }

const starters = [
  'Launch a Facebook + Instagram post for our AI automation course',
  'Build a full branding campaign from idea to published post',
  'Write a short LinkedIn post about our new feature',
];

const answerSummary = (answers: Record<string, string | string[]>): string => {
  const parts = Object.entries(answers)
    .filter(([, v]) => (Array.isArray(v) ? v.length : String(v).trim()))
    .map(([, v]) => (Array.isArray(v) ? v.join(', ') : v));
  return parts.length ? parts.join(' · ') : 'Continue';
};

export function OrchestratePanel({ restore, notify, onRunActivity }: Props) {
  const [messages, setMessages] = useState<Msg[]>(restore?.messages ?? []);
  const [run, setRun] = useState<WorkflowRunDto | null>(restore?.run ?? null);
  const [sessionId, setSessionId] = useState<string | null>(restore?.sessionId ?? null);
  const [input, setInput] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const hasStarted = messages.length > 0 || Boolean(pending) || busy;
  const push = (m: Msg) => setMessages((prev) => [...prev, m]);

  // Apply a run response: update the card, thread the chat session, surface the
  // authored assistant reply as a bubble, and tell App to refresh the sidebar.
  const applyRun = (data: WorkflowRunDto) => {
    setRun(data);
    if (data.chatSessionId) { setSessionId(data.chatSessionId); onRunActivity(data.chatSessionId); }
    if (data.assistantMessage) push({ role: 'agent', content: data.assistantMessage });
  };

  const start = async (text: string) => {
    if (text.trim().length < 3) { notify('Describe your goal first', 'err'); return; }
    setInput(''); setAnswers({}); setPending(text.trim()); setBusy(true);
    try {
      const r = await api.createRun(text.trim(), sessionId ?? undefined);
      if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
      push({ role: 'user', content: text.trim() });
      applyRun(r.data);
    } finally { setPending(null); setBusy(false); }
  };

  const submitAnswers = async () => {
    if (!run) return;
    const summary = answerSummary(answers);
    setPending(summary); setBusy(true);
    try {
      const r = await api.clarifyRun(run.id, answers);
      if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
      push({ role: 'user', content: summary });
      setAnswers({});
      applyRun(r.data);
    } finally { setPending(null); setBusy(false); }
  };

  const approve = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.approveRun(run.id);
      if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
      setRun(r.data); notify('Workflow executing…');
    } finally { setBusy(false); }
  };

  const approveNode = async (nodeId: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.approveRunNode(run.id, nodeId);
      if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
      setRun(r.data); notify('Publishing…');
    } finally { setBusy(false); }
  };

  // Live node.status: patch dots while running; on a terminal event refetch so
  // artifacts + publish results land, and nudge the sidebar (Active Flows).
  const liveRunId = run && (run.status === 'running' || run.status === 'needs_approval') ? run.id : null;
  useRunEvents(liveRunId, (ev) => {
    setRun((cur) => {
      if (!cur || cur.id !== ev.runId) return cur;
      return { ...cur, nodes: cur.nodes.map((n) => n.nodeId === ev.nodeId ? { ...n, status: ev.status, error: ev.error ?? n.error } : n) };
    });
    if (ev.status === 'completed' || ev.status === 'failed') {
      void api.getRun(ev.runId).then((r) => { if (r.ok) { setRun(r.data); if (r.data.chatSessionId) onRunActivity(r.data.chatSessionId); } });
    }
  });

  const setAnswer = (slot: string, value: string | string[]) => setAnswers((a) => ({ ...a, [slot]: value }));
  const toggleMulti = (slot: string, choice: string) => {
    const cur = (answers[slot] as string[] | undefined) ?? [];
    setAnswer(slot, cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice]);
  };

  const showClarify = run?.status === 'awaiting_clarification' && run.questions;
  const showPlan = run && run.nodes.length > 0;

  return (
    <section className={`master-chat-main ${hasStarted ? 'started' : ''}`}>
      {!hasStarted && (
        <div className="empty-chat-hero">
          <h1>What should we orchestrate?</h1>
          <p>Describe a marketing goal. The Master Agent reasons about it, asks only what materially shapes the result, then plans a dynamic agent workflow you approve before anything publishes.</p>
        </div>
      )}

      {hasStarted && (
        <div className="chat-transcript">
          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>
          ))}
          {pending && <div className="chat-bubble user">{pending}</div>}
          {busy && (
            <div className="chat-bubble agent thinking-bubble" role="status" aria-live="polite">
              <span className="thinking-copy">Thinking</span>
              <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
            </div>
          )}

          {!busy && showClarify && (
            <ClarifyCard
              questions={run!.questions!}
              answers={answers}
              busy={busy}
              onAnswer={setAnswer}
              onToggleMulti={toggleMulti}
              onSubmit={() => void submitAnswers()}
            />
          )}
          {!busy && showPlan && (
            <PlanCard run={run!} busy={busy} onApprove={() => void approve()} onApproveNode={(id) => void approveNode(id)} />
          )}
        </div>
      )}

      <div className="floating-composer">
        <div className="composer-box">
          <button className="composer-plus" aria-label="Add context">+</button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(input); } }}
            placeholder="Describe a marketing goal to orchestrate…"
          />
          <button
            className={`composer-send ${busy ? 'loading' : ''}`}
            disabled={busy}
            onClick={() => void start(input)}
            aria-label={busy ? 'Working' : 'Send'}
          >{busy ? '…' : '↑'}</button>
        </div>
        {!hasStarted && (
          <div className="prompt-chip-row">
            {starters.map((chip) => (
              <button className="prompt-chip" key={chip} onClick={() => setInput(chip)}>{chip}</button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
