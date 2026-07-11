// Orchestrate panel — the M1 goal-based Master Agent as a CONVERSATIONAL surface.
// One unified chat: the user types a goal, the agent restates intent + asks the
// high-impact missing questions AS PROSE (no form — the assistant bubble carries the
// questions in the user's language), then presents the planned DAG as an in-chat card.
// Answering is free text (routed through refine); add/remove a step is free text too.
// Approving SAVES the plan as a named Saved Flow and hands off to Active Flows for
// execution — nothing runs on this surface (keeps the chat responsive, no JSON dump).
import { useEffect, useRef, useState } from 'react';
import { api, type WorkflowRunDto } from '../api/client';
import { PlanCard, SaveOfferCard } from './orchestrate-run-cards';
import { AtriaSuggestionCards } from './atria-suggestion-cards';
import { AtriaResumeWorkCards } from './atria-resume-work-cards';
import { TypewriterText } from './typewriter-text';
import { ReadAloudButton } from './read-aloud-button';
import { wantsSpokenReply } from '../lib/read-intent';
import { useSpeechRecognition } from '../hooks/use-speech-recognition';
import { speak, stopSpeaking } from '../lib/tts-player';

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
  // Submit initialInput immediately on mount instead of parking it in the composer.
  // "Plan it" on Atria and the Command Center bar are SENDS, not drafts — landing the
  // user on an idle composer reads as the intent being swallowed.
  autoStart?: boolean;
  // Fired once, right after the auto-start send is dispatched, so the parent can CLEAR the prefill —
  // otherwise a remount (tab switch / refresh) would re-run autoStart and re-send (duplicate LLM call).
  onAutoStarted?: () => void;
  // Empty-state "Continue where you left off" — recent chats + saved flows with no
  // campaign. Atria IS this surface, so the strategist home lives here, not on a hub page.
  chats: Array<{ id: string; title: string; updatedAt: string }>;
  onResumeChat: (id: string) => void;
}

// `offerRead` marks an Atria reply the user implicitly asked to hear (read-intent in their message):
// its bubble shows a prominent "read the result aloud" confirm instead of the small speaker icon.
interface Msg { role: 'user' | 'agent'; content: string; offerRead?: boolean }

const starters = [
  'Launch a Facebook + Instagram post for our AI automation course',
  'Build a full branding campaign from idea to published post',
  'Write a short LinkedIn post about our new feature',
];

export function OrchestratePanel({ restore, flowsWithoutStrategy, notify, onRunActivity, onSaved, onSetupCampaign, onOpenFlow, onCampaignCreated, initialInput, autoStart, onAutoStarted, chats, onResumeChat }: Props) {
  const [messages, setMessages] = useState<Msg[]>(restore?.messages ?? []);
  // Messages present at mount (restored history) render instantly; only messages added afterwards get
  // the typewriter reveal, and only the newest one (P3 — "alive" feel without re-typing old replies).
  const initialCount = useRef(restore?.messages.length ?? 0);
  const [run, setRun] = useState<WorkflowRunDto | null>(restore?.run ?? null);
  const [sessionId, setSessionId] = useState<string | null>(restore?.sessionId ?? null);
  const [input, setInput] = useState(restore || autoStart ? '' : (initialInput ?? ''));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const autoStarted = useRef(false);

  // ── Voice mode ────────────────────────────────────────────────────────────────────────────────────
  // `voiceMode` = hands-free round-trip: mic STT in, auto-TTS out, and (continuous) re-listen after
  // Atria speaks. The mic button works as push-to-talk even with the toggle off. State machine:
  // idle → listening → thinking → speaking → (voiceMode ? listening : idle).
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false); voiceModeRef.current = voiceMode;
  const [speaking, setSpeaking] = useState(false);
  const startRef = useRef<(t: string) => void>(() => {}); // set after start() is defined (avoids TDZ cycle)

  const sr = useSpeechRecognition({
    lang: 'vi-VN', // VN-first app; Web Speech still handles common English. Server STT is the upgrade path.
    visualize: true, // core rides mic amplitude while listening
    onInterim: (t) => setInput(t), // live transcript into the composer
    onFinal: (t) => { setInput(''); startRef.current(t); }, // silence-end → auto-send
  });

  // Speak Atria's reply; in continuous voice mode, re-open the mic once narration ends naturally
  // (an interrupted clip means the user barged in — don't fight them by re-listening here).
  const speakReply = async (text: string) => {
    if (!text.trim()) return;
    setSpeaking(true);
    try {
      const h = await speak(text, {
        onEnd: (interrupted) => {
          setSpeaking(false);
          if (voiceModeRef.current && !interrupted) sr.start();
        },
      });
      await h.done;
    } catch { setSpeaking(false); }
  };

  const micClick = () => {
    if (sr.listening) { sr.stop(); return; }
    stopSpeaking(); // barge-in: talking over Atria pauses her narration
    sr.start();
  };

  const toggleVoiceMode = () => {
    setVoiceMode((on) => {
      const next = !on;
      if (next) { stopSpeaking(); sr.start(); } // enter → start listening immediately
      else { sr.stop(); stopSpeaking(); setSpeaking(false); } // exit → stop everything
      return next;
    });
  };

  const voiceState: 'idle' | 'listening' | 'thinking' | 'speaking' =
    sr.listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle';

  // Esc exits voice mode / stops the round-trip (P3).
  useEffect(() => {
    if (!voiceMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setVoiceMode(false); sr.stop(); stopSpeaking(); setSpeaking(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceMode, sr]);

  const hasStarted = messages.length > 0 || Boolean(pending) || busy;
  const push = (m: Msg) => setMessages((prev) => [...prev, m]);

  // Apply a run response: update the card, thread the chat session, surface the
  // authored assistant reply as a bubble, and tell App to refresh the sidebar.
  const applyRun = (data: WorkflowRunDto, offerRead = false) => {
    setRun(data);
    if (data.chatSessionId) { setSessionId(data.chatSessionId); onRunActivity(data.chatSessionId); }
    if (data.assistantMessage) push({ role: 'agent', content: data.assistantMessage, offerRead });
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
      // Voice mode → tell the backend so Atria keeps the (spoken) reply short (faster TTS, less delay).
      const r = await api.createRun(trimmed, sessionId ?? undefined, { voice: voiceModeRef.current });
      if (!r.ok) { notify(`Orchestration: ${r.error.error}`, 'err'); return; }
      push({ role: 'user', content: trimmed });
      // Read-intent ("read the report", "how are campaigns going?") → offer to read Atria's reply
      // aloud (a confirm, never auto-play). Reads the RESULT text, not what the user typed.
      applyRun(r.data, wantsSpokenReply(trimmed));
      // Voice mode → speak the reply hands-free (the toggle IS the standing autoplay gesture).
      if (voiceModeRef.current && r.data.assistantMessage) void speakReply(r.data.assistantMessage);
    } finally { setPending(null); setBusy(false); }
  };
  startRef.current = start;

  // Auto-submit the seeded intent exactly once on a fresh mount (never on restore).
  // Ref guard instead of effect deps: StrictMode double-invoke or a re-render must not
  // fire a second createRun for the same seed.
  useEffect(() => {
    if (!autoStart || restore || autoStarted.current) return;
    const seed = (initialInput ?? '').trim();
    if (!seed) return;
    autoStarted.current = true;
    onAutoStarted?.(); // tell the parent to consume the prefill so a remount can't re-send it
    // A seed too short to be a goal parks in the composer instead of bouncing off the
    // length guard in start() (which would drop the intent entirely).
    if (seed.length < 3) { setInput(seed); return; }
    void start(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // "▶ Duyệt & Chạy ngay" — approve + execute the PLANNED run directly (no save-as-template detour),
  // then jump to Active Flows where SSE drives the live DAG. The run generates content and halts at the
  // approval gate before any publish/send. needs_connection parks the run + tells the user to connect.
  const execute = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) { notify(`Chạy flow: ${r.error.error}`, 'err'); return; }
      if (r.data.status === 'needs_connection') {
        applyRun(r.data);
        notify('Cần kết nối nền tảng trước khi chạy — mở tab Connections để kết nối rồi chạy lại.', 'err');
        return;
      }
      onOpenFlow(run.id); // running → live DAG in Active Flows
    } finally { setBusy(false); }
  };

  // P6 "Run a test post" — execute the saved flow, then hand off to Active Flows where
  // SSE drives the live DAG (and needs_connection degrades to the connect card there).
  const runTest = async () => {
    if (!run) return;
    setBusy(true);
    try {
      // A saved flow is a template — clone+run it into a fresh instance, then open THAT instance.
      const r = await api.testRunFlow(run.id);
      if (!r.ok) { notify(`Run flow: ${r.error.error}`, 'err'); return; }
      onOpenFlow(r.data.id);
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
          <p>Describe a marketing goal. Atria reasons about it, asks only what materially shapes the result, then plans a dynamic agent workflow. Save it as a flow and run it from Active Flows.</p>
          <div className="atria-home-stack">
            <section>
              <h3 className="atria-section-title">Reminders from Atria</h3>
              <AtriaSuggestionCards notify={notify} onPlanCampaign={(t) => void start(t)} />
            </section>
            <AtriaResumeWorkCards
              chats={chats.slice(0, 4)}
              flows={flowsWithoutStrategy.slice(0, 4)}
              onResumeChat={onResumeChat}
              onOpenFlow={onOpenFlow}
            />
          </div>
        </div>
      )}

      {hasStarted && (
        <div className="chat-transcript">
          {messages.map((m, i) => {
            const animate = m.role === 'agent' && i >= initialCount.current && i === messages.length - 1;
            return (
              <div key={i} className={`chat-bubble ${m.role}`}>
                {m.role === 'agent' ? <TypewriterText text={m.content} animate={animate} /> : m.content}
                {m.role === 'agent' && m.content.trim().length > 0 && (
                  m.offerRead
                    ? <ReadAloudButton text={m.content} className="bubble-tts tts-offer" label="Đọc kết quả cho bạn" />
                    : <ReadAloudButton text={m.content} className="bubble-tts" />
                )}
              </div>
            );
          })}
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
              onExecute={() => void execute()}
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
        {sr.supported && (voiceMode || voiceState !== 'idle') && (
          <div className={`voice-status is-${voiceState}`} role="status" aria-live="polite">
            <span className="voice-status-dot" aria-hidden="true" />
            {voiceState === 'listening' && 'Đang nghe…'}
            {voiceState === 'thinking' && 'Atria đang suy nghĩ…'}
            {voiceState === 'speaking' && 'Atria đang nói — chạm mic để ngắt lời'}
            {voiceState === 'idle' && 'Chế độ giọng nói bật — chạm mic để nói'}
            {voiceMode && <span className="voice-status-exit"> · Esc để thoát</span>}
          </div>
        )}
        <div className={`composer-box ${voiceState === 'listening' ? 'is-listening' : ''}`}>
          <button className="composer-plus" aria-label="Add context">+</button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(input); } }}
            placeholder={
              voiceState === 'listening' ? 'Nói đi — Atria đang nghe…'
              : showPlan ? 'Refine the plan — e.g. “thêm video” or “bỏ infographic”…'
              : 'Describe a marketing goal to orchestrate…'
            }
          />
          {sr.supported && (
            <>
              <button
                type="button"
                className={`composer-voice ${voiceMode ? 'is-on' : ''}`}
                onClick={toggleVoiceMode}
                title={voiceMode ? 'Tắt chế độ giọng nói' : 'Bật chế độ giọng nói (rảnh tay)'}
                aria-pressed={voiceMode}
                aria-label="Voice mode"
              >🎙</button>
              <button
                type="button"
                className={`composer-mic ${sr.listening ? 'is-listening' : ''}`}
                onClick={micClick}
                title={sr.listening ? 'Dừng nghe' : 'Nói với Atria'}
                aria-label={sr.listening ? 'Stop listening' : 'Speak'}
              >{sr.listening ? '■' : '🎤'}</button>
            </>
          )}
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
