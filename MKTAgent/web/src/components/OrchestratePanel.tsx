// Orchestrate panel — the M1 goal-based Master Agent as a CONVERSATIONAL surface.
// One unified chat: the user types a goal, the agent restates intent + asks the
// high-impact missing questions AS PROSE (no form — the assistant bubble carries the
// questions in the user's language), then presents the planned DAG as an in-chat card.
// Answering is free text (routed through refine); add/remove a step is free text too.
// Approving SAVES the plan as a named Saved Flow and hands off to Active Flows for
// execution — nothing runs on this surface (keeps the chat responsive, no JSON dump).
import { useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';
import { PlanCard, SaveOfferCard } from './orchestrate-run-cards';

export interface OrchestrateRestore {
  sessionId: string;
  messages: Array<{ role: 'user' | 'agent'; content: string }>;
  run: WorkflowRunDto | null;
}

export interface FlowHint { id: string; name: string }

interface Props {
  restore: OrchestrateRestore | null;
  // P6 "on return" hint — saved flows with no campaign/strategy yet; nudged on the hero.
  flowsWithoutStrategy: FlowHint[];
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onRunActivity: (sessionId: string) => void;
  // Saved a flow → refresh the sidebar list (no redirect — the P6 offer stays in chat).
  onSaved: (runId: string) => void;
  // P6 offer actions. Set up campaign = create the container under the flow + open it.
  // Open flow = plain redirect to Active Flows. (Run a test post is handled in-panel.)
  onSetupCampaign: (runId: string) => void;
  onOpenFlow: (runId: string) => void;
  // Item 2 (Option A): the backend created a campaign under the saved flow from a chat
  // message — navigate to its board (optionally selecting the created post).
  onCampaignCreated: (campaignId: string, postId?: string) => void;
  // Seed the composer once (e.g. a command typed on the Command Center before it
  // redirects here). Only applied on a fresh mount; ignored when restoring a chat.
  initialInput?: string;
}

interface Msg { role: 'user' | 'agent'; content: string }

const starters = [
  'Launch a Facebook + Instagram post for our AI automation course',
  'Build a full branding campaign from idea to published post',
  'Write a short LinkedIn post about our new feature',
];

export function OrchestratePanel({ restore, flowsWithoutStrategy, notify, onRunActivity, onSaved, onSetupCampaign, onOpenFlow, onCampaignCreated, initialInput }: Props) {
  const [messages, setMessages] = useState<Msg[]>(restore?.messages ?? []);
  const [run, setRun] = useState<WorkflowRunDto | null>(restore?.run ?? null);
  const [sessionId, setSessionId] = useState<string | null>(restore?.sessionId ?? null);
  const [input, setInput] = useState(restore ? '' : (initialInput ?? ''));
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
    // Item 2 (Option A): the backend created a campaign under the saved flow — show the
    // confirmation bubble, then navigate to the new campaign board (with the post if any).
    if (data.createdCampaignId) onCampaignCreated(data.createdCampaignId, data.createdPostId);
  };

  // Every message goes through createRun — the backend treats a follow-up on a
  // pre-execution run as a refinement (additive + subtractive), so typing answers,
  // "add a video", or "bỏ infographic" all flow through here. No client-side form.
  const start = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3) { notify('Describe your goal first', 'err'); return; }
    setInput(''); setPending(trimmed); setBusy(true);
    try {
      const r = await api.createRun(trimmed, sessionId ?? undefined);
      if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
      push({ role: 'user', content: trimmed });
      applyRun(r.data);
    } finally { setPending(null); setBusy(false); }
  };

  // Save names the flow and (P6) returns the Master Agent's guiding offer as
  // assistantMessage. We stay in the chat, surface the offer bubble + action card, and
  // only refresh the sidebar — the user chooses the next step (set up / test / open).
  const save = async (name: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.saveRun(run.id, name);
      if (!r.ok) { notify(`Save flow: ${r.error.error}`, 'err'); return; }
      setRun(r.data);
      if (r.data.assistantMessage) push({ role: 'agent', content: r.data.assistantMessage });
      notify(`Flow “${name}” saved`);
      onSaved(run.id);
    } finally { setBusy(false); }
  };

  // P6 "Run a test post" — execute the saved flow, then hand off to Active Flows where
  // SSE drives the live DAG (and needs_connection degrades to the connect card there).
  const runTest = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) { notify(`Run flow: ${r.error.error}`, 'err'); return; }
      onOpenFlow(run.id);
    } finally { setBusy(false); }
  };

  const showPlan = run && run.nodes.length > 0;
  // Offer appears once the flow is named (saved) and still holds a plan to act on. (A
  // chat "create campaign" on a saved flow now creates it server-side and navigates away
  // via onCampaignCreated — item 2 Option A — so it doesn't rely on this card.)
  const showOffer = Boolean(run?.name) && showPlan;

  return (
    <section className={`master-chat-main ${hasStarted ? 'started' : ''}`}>
      {!hasStarted && (
        <div className="empty-chat-hero">
          <h1>What should we orchestrate?</h1>
          <p>Describe a marketing goal. The Master Agent reasons about it, asks only what materially shapes the result, then plans a dynamic agent workflow. Save it as a flow and run it from Active Flows.</p>
          {flowsWithoutStrategy.length > 0 && (
            <div className="flow-hint">
              <span className="muted small">Pick up where you left off — flows with no campaign yet:</span>
              <div className="flow-hint-row">
                {flowsWithoutStrategy.slice(0, 4).map((f) => (
                  <button key={f.id} className="prompt-chip" onClick={() => onSetupCampaign(f.id)}>⚡ {f.name}</button>
                ))}
              </div>
            </div>
          )}
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

          {!busy && showPlan && (
            <PlanCard
              run={run!}
              busy={busy}
              defaultName={(run!.goal as { slots?: { product?: string } } | null)?.slots?.product ?? ''}
              onSave={(name) => void save(name)}
            />
          )}

          {!busy && showOffer && (
            <SaveOfferCard
              busy={busy}
              onSetupCampaign={() => onSetupCampaign(run!.id)}
              onRunTest={() => void runTest()}
              onOpenFlow={() => onOpenFlow(run!.id)}
            />
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
            placeholder={showPlan ? 'Refine the plan — e.g. “thêm video” or “bỏ infographic”…' : 'Describe a marketing goal to orchestrate…'}
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
