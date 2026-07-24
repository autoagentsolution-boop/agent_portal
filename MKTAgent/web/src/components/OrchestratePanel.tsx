// Orchestrate panel — the M1 goal-based Master Agent as a CONVERSATIONAL surface.
// One unified chat: the user types a goal, the agent restates intent + asks the
// high-impact missing questions AS PROSE (no form — the assistant bubble carries the
// questions in the user's language), then presents the planned DAG as an in-chat card.
// Answering is free text (routed through refine); add/remove a step is free text too.
// Approving SAVES the plan as a named Saved Flow and hands off to Active Flows for
// execution — nothing runs on this surface (keeps the chat responsive, no JSON dump).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, type WorkflowRunDto, type CalendarSlotDto } from '../api/client';
import { PlanCard, SaveOfferCard } from './orchestrate-run-cards';
import { ContentCalendar } from './content-calendar';
import { AtriaSuggestionCards } from './atria-suggestion-cards';
import { AtriaResumeWorkCards } from './atria-resume-work-cards';
import { TypewriterText } from './typewriter-text';
import { ReadAloudButton } from './read-aloud-button';
import { wantsSpokenReply } from '../lib/read-intent';
import { useSpeechRecognition } from '../hooks/use-speech-recognition';
import { speak, stopSpeaking } from '../lib/tts-player';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

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
  // Files attached from the Command Center LANDING view (before this panel existed) — consumed once on
  // mount through the SAME attach-to-summarize handler the in-chat "+" button uses (no duplicated logic).
  pendingAttachFiles?: File[] | null;
  onPendingAttachConsumed?: () => void;
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
  // Opened from the Command Center voice button → enter hands-free voice mode on mount
  // (mic in, TTS out, re-listen), so the user starts talking to Atria without a second click.
  autoVoice?: boolean;
  // P1 voice unification: the panel OWNS the voice machine but reports its state up so the Command
  // Center's central Atria core can reflect it AND toggle it (single source of truth, one control).
  onVoiceChange?: (v: { mode: boolean; state: VoiceState }) => void;
  // Empty-state "Continue where you left off" — recent chats + saved flows with no
  // campaign. Atria IS this surface, so the strategist home lives here, not on a hub page.
  chats: Array<{ id: string; title: string; updatedAt: string }>;
  onResumeChat: (id: string) => void;
}

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Imperative handle the Command Center core drives (P1): one persistent, two-way voice control living
// on the core, calling into the panel that owns the STT/TTS machine — no duplicated state.
export interface OrchestrateHandle {
  toggleVoice: () => void;
  stopVoice: () => void;
}

// `offerRead` marks an Atria reply the user implicitly asked to hear (read-intent in their message):
// its bubble shows a prominent "read the result aloud" confirm instead of the small speaker icon.
interface Msg { role: 'user' | 'agent'; content: string; offerRead?: boolean }

export const OrchestratePanel = forwardRef<OrchestrateHandle, Props>(function OrchestratePanel({ restore, flowsWithoutStrategy, notify, onRunActivity, onSaved, onSetupCampaign, onOpenFlow, onCampaignCreated, initialInput, autoStart, onAutoStarted, autoVoice, onVoiceChange, chats, onResumeChat, pendingAttachFiles, onPendingAttachConsumed }, ref) {
  const { t } = useLocale();
  const starters = [
    t('orchestrate.starter.social_course'),
    t('orchestrate.starter.branding_campaign'),
    t('orchestrate.starter.linkedin_feature'),
  ];
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
  // Guards the strategist calendar poll (P2) so a late setRun never fires on an unmounted panel.
  const mountedRef = useRef(true);

  // ── Voice mode ────────────────────────────────────────────────────────────────────────────────────
  // `voiceMode` = hands-free round-trip: mic STT in, auto-TTS out, and (continuous) re-listen after
  // Atria speaks. The mic button works as push-to-talk even with the toggle off. State machine:
  // idle → listening → thinking → speaking → (voiceMode ? listening : idle).
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false); voiceModeRef.current = voiceMode;
  const [speaking, setSpeaking] = useState(false);
  const startRef = useRef<(t: string) => void>(() => {}); // set after start() is defined (avoids TDZ cycle)

  const sr = useSpeechRecognition({
    // Omit `lang` → the hook follows the browser locale. Pinning 'vi-VN' assumed a VN-first user base,
    // but the product ships 31 content languages: an Indonesian or Korean speaker was being transcribed
    // against a Vietnamese model. Server STT is still the upgrade path for real multi-language voice.
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
    // Read the current value from the ref and run the mic side-effects OUTSIDE the setState updater —
    // a side-effect inside the updater is double-invoked under React 18 StrictMode (dev), which would
    // start()→start() (or start()→abort()) the SpeechRecognition and leave the mic not actually listening.
    const next = !voiceModeRef.current;
    voiceModeRef.current = next;
    setVoiceMode(next);
    if (next) { stopSpeaking(); sr.start(); } // enter → start listening immediately
    else { sr.stop(); stopSpeaking(); setSpeaking(false); } // exit → stop everything
  };

  const voiceState: VoiceState =
    sr.listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle';

  // Full stop (nav-away / close): kill the hands-free loop + any narration. Idempotent.
  const stopVoice = () => { setVoiceMode(false); sr.stop(); stopSpeaking(); setSpeaking(false); };

  // Expose the two-way toggle + stop to the Command Center core (P1). Recreated each render so the
  // captured closures (sr, setters) are never stale — the handle is trivial, so the cost is nil.
  useImperativeHandle(ref, () => ({ toggleVoice: toggleVoiceMode, stopVoice }));

  // Report voice mode + state UP so the CC core mirrors it (glow already rides global root attrs). Fires
  // only when the mode/state string actually changes; onVoiceChange is a stable useCallback in App.
  useEffect(() => { onVoiceChange?.({ mode: voiceMode, state: voiceState }); }, [voiceMode, voiceState, onVoiceChange]);

  // If the panel unmounts mid-session (chat closed, tab switched) while voice is live, stop STT + TTS so
  // the mic/narration never keeps running detached. Runs once on unmount.
  // Set true on (re)mount, false on unmount — NOT relying on the useRef init, so a StrictMode dev
  // double-mount (mount → cleanup → remount) can't leave the flag stuck false and kill the strategist poll.
  // Only stop TTS here; useSpeechRecognition already aborts its recognition + releases the mic on unmount,
  // so calling sr.stop() here too would double-abort and, under StrictMode, kill the mic autoVoice just
  // started (the "opens chat but doesn't record" bug). Nav-away voice stop is handled explicitly in App.
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; stopSpeaking(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened via the Command Center voice button → enter hands-free voice mode + START LISTENING, so the user
  // can speak right away (no second tap). DEFERRED with a cancel-on-unmount timer: React 18 StrictMode's dev
  // mount→unmount→remount would otherwise fire start()→abort()→start() on the browser's singleton
  // SpeechRecognition — the 2nd start() throws "already started" (caught → mic stuck IDLE, the "voice mode on
  // but not listening" bug). The unmount clears the first, spurious timer, so ONLY the final stable mount
  // starts recognition — exactly once. The !voiceMode guard makes a repeat flag harmless.
  useEffect(() => {
    if (!autoVoice || !sr.supported) return;
    const t = window.setTimeout(() => { if (!voiceModeRef.current) toggleVoiceMode(); }, 120);
    return () => window.clearTimeout(t);
  }, [autoVoice]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (trimmed.length < 3) { notify(t('orchestrate.goal.required'), 'err'); return; }
    setInput(''); setPending(trimmed); setBusy(true);
    try {
      // A submit while a PLANNED flow card is on screen is a plan refinement (this box is the "Refine the
      // plan" box) — tell the backend so it re-plans deterministically instead of leaving the edit to the
      // brain's discretion (which is unreliable for node removals).
      const isRefine = Boolean(run && run.nodes.length > 0 && run.status === 'planned');
      // Voice mode → tell the backend so Atria keeps the (spoken) reply short (faster TTS, less delay).
      const r = await api.createRun(trimmed, sessionId ?? undefined, { voice: voiceModeRef.current, refine: isRefine });
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      push({ role: 'user', content: trimmed });
      // Read-intent ("read the report", "how are campaigns going?") → offer to read Atria's reply
      // aloud (a confirm, never auto-play). Reads the RESULT text, not what the user typed.
      applyRun(r.data, wantsSpokenReply(trimmed));
      // Voice mode → speak the reply hands-free (the toggle IS the standing autoplay gesture).
      if (voiceModeRef.current && r.data.assistantMessage) void speakReply(r.data.assistantMessage);
    } finally { setPending(null); setBusy(false); }
  };
  startRef.current = start;

  // Attach-to-summarize (+): upload a document/image, extract its text server-side, then send it as a
  // summarize request. The Data Guard (security) node masks any personal/sensitive data before summarizing.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const readAsB64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const onFilesPicked = async (files: File[] | null) => {
    if (!files || !files.length) return;
    setUploading(true); setBusy(true);
    try {
      const docs = await Promise.all(files.slice(0, 6).map(async (f) => ({ name: f.name, mimeType: f.type || 'application/octet-stream', dataB64: await readAsB64(f) })));
      const ext = await api.extractDocumentText(docs);
      if (!ext.ok) { notify(tError(ext.error), 'err'); return; }
      const names = ext.data.names.join(', ');
      notify(t('orchestrate.attach.read_notice', { chars: ext.data.chars.toLocaleString(), names }), 'ok');
      push({ role: 'user', content: t('orchestrate.attach.summarize_bubble', { names }) });
      // Direct summarize+security run (NOT via the chat brain — raw PII would trip its safety filter).
      const r = await api.summarizeFile(ext.data.text, names, sessionId ?? undefined);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      applyRun(r.data, false);
    } catch {
      notify(t('orchestrate.file.read_failed'), 'err');
    } finally { setUploading(false); setBusy(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

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

  // Consume a file attached on the Command Center LANDING view (before this panel mounted) exactly
  // once — same ref-guard pattern as autoStart, so a StrictMode dev double-mount can't re-fire the
  // upload. Runs the EXISTING onFilesPicked handler, so the summarize-file logic is never duplicated.
  const attachConsumed = useRef(false);
  useEffect(() => {
    if (attachConsumed.current || !pendingAttachFiles || !pendingAttachFiles.length) return;
    attachConsumed.current = true;
    onPendingAttachConsumed?.();
    void onFilesPicked(pendingAttachFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAttachFiles]);

  // Save names the flow and (P6) returns the Master Agent's guiding offer as
  // assistantMessage. We stay in the chat, surface the offer bubble + action card, and
  // only refresh the sidebar — the user chooses the next step (set up / test / open).
  const save = async (name: string) => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await api.saveRun(run.id, name);
      if (!r.ok) { notify(tError(r.error), 'err'); return; }
      setRun(r.data);
      if (r.data.assistantMessage) push({ role: 'agent', content: r.data.assistantMessage });
      notify(t('flow.save.success', { name }));
      onSaved(run.id);
    } finally { setBusy(false); }
  };

  // "▶ Duyệt & Chạy ngay" — approve + execute the PLANNED run directly (no save-as-template detour),
  // then jump to Active Flows where SSE drives the live DAG. The run generates content and halts at the
  // approval gate before any publish/send. needs_connection parks the run + tells the user to connect.
  const execute = async () => {
    if (!run) return;
    const strategist = run.nodes.some((n) => n.agentId === 'campaign_strategist');
    setBusy(true);
    try {
      const r = await api.executeRun(run.id);
      if (!r.ok) {
        if (r.error.status === 402) { notify(t('credits.exhausted'), 'err'); return; }
        notify(tError(r.error), 'err'); return;
      }
      if (r.data.status === 'needs_connection') {
        applyRun(r.data);
        notify(t('orchestrate.connect.required'), 'err');
        return;
      }
      // Single/other flows → hand off to Active Flows (live DAG) as before.
      if (!strategist) { onOpenFlow(run.id); return; }
      // Strategist campaign (P2): keep it INLINE. The run drafts research→strategy→calendar and parks at
      // its selection gate; poll until the content_calendar is ready, then the editable calendar renders
      // right here — the user never leaves chat to see/approve Atria's proposal.
      setRun(r.data);
      await pollStrategistGate(run.id);
    } finally { setBusy(false); }
  };

  // Bounded poll for the strategist selection gate (the calendar). Updates the card live; stops on the
  // gate, a terminal state, or after the cap (then points to Active Flows). Unmount-guarded.
  const pollStrategistGate = async (runId: string) => {
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 2500));
      const rr = await api.getRun(runId);
      if (!mountedRef.current) return; // bail on unmount before touching state — but never gate the loop on it
      if (!rr.ok) continue;
      setRun(rr.data);
      const st = rr.data.status;
      if (st === 'needs_approval') return; // calendar gate → inline ContentCalendar renders below
      if (st === 'completed' || st === 'failed' || st === 'aborted') {
        notify(st === 'failed' ? t('strategist.run.failed') : t('strategist.run.finished'), st === 'failed' ? 'err' : 'ok');
        return;
      }
    }
    if (mountedRef.current) notify(t('strategist.run.still_drafting'), 'ok');
  };

  // P6 "Run a test post" — execute the saved flow, then hand off to Active Flows where
  // SSE drives the live DAG (and needs_connection degrades to the connect card there).
  const runTest = async () => {
    if (!run) return;
    setBusy(true);
    try {
      // A saved flow is a template — clone+run it into a fresh instance, then open THAT instance.
      const r = await api.testRunFlow(run.id);
      if (!r.ok) {
        if (r.error.status === 402) { notify(t('credits.exhausted'), 'err'); return; }
        notify(tError(r.error), 'err'); return;
      }
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
          <h1>{t('orchestrate.hero.title')}</h1>
          <p>{t('orchestrate.hero.subtitle')}</p>
          <div className="atria-home-stack">
            <section>
              <h3 className="atria-section-title">{t('orchestrate.hero.reminders_title')}</h3>
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
                    ? <ReadAloudButton text={m.content} className="bubble-tts tts-offer" label={t('orchestrate.read_aloud.offer_label')} />
                    : <ReadAloudButton text={m.content} className="bubble-tts" />
                )}
              </div>
            );
          })}
          {pending && <div className="chat-bubble user">{pending}</div>}
          {busy && (
            <div className="chat-bubble agent thinking-bubble" role="status" aria-live="polite">
              <span className="thinking-copy">{t('orchestrate.thinking')}</span>
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

          {/* Strategist calendar INLINE (P2): the run parked at the campaign_strategist selection gate with
              an editable content calendar. Reuse the same component Active Flows uses — approve → materialize
              → grant, without leaving chat. Deep edit stays available via Active Flows. */}
          {run && run.status === 'needs_approval' && run.nodes.some((n) => n.agentId === 'campaign_strategist') && (
            <div className="dag-block run-card">
              <ContentCalendar
                runId={run.id}
                slots={(run.artifacts.find((a) => a.type === 'content_calendar')?.data as { slots?: CalendarSlotDto[] } | undefined)?.slots ?? []}
                notify={notify}
                onDone={(cid) => onCampaignCreated(cid)}
              />
              <button className="btn ghost" onClick={() => onOpenFlow(run.id)}>{t('orchestrate.calendar.open_deep_edit')}</button>
            </div>
          )}
        </div>
      )}

      <div className="floating-composer">
        {sr.supported && (voiceMode || voiceState !== 'idle') && (
          <div className={`voice-status is-${voiceState}`} role="status" aria-live="polite">
            <span className="voice-status-dot" aria-hidden="true" />
            {voiceState === 'listening' && t('orchestrate.voice.listening')}
            {voiceState === 'thinking' && t('orchestrate.voice.thinking')}
            {voiceState === 'speaking' && t('orchestrate.voice.speaking')}
            {voiceState === 'idle' && t('orchestrate.voice.idle_on')}
            {voiceMode && <span className="voice-status-exit">{t('orchestrate.voice.esc_exit')}</span>}
          </div>
        )}
        <div className={`composer-box ${voiceState === 'listening' ? 'is-listening' : ''}`}>
          <button
            className="composer-plus"
            aria-label={t('orchestrate.attach.aria_label')}
            title={t('orchestrate.attach.title')}
            disabled={busy || uploading}
            onClick={() => fileInputRef.current?.click()}
          >{uploading ? '…' : '+'}</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown"
            multiple
            hidden
            onChange={(e) => void onFilesPicked(e.target.files ? Array.from(e.target.files) : null)}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(input); } }}
            placeholder={
              voiceState === 'listening' ? t('orchestrate.composer.placeholder_listening')
              : showPlan ? t('orchestrate.composer.placeholder_refine')
              : t('orchestrate.composer.placeholder_goal')
            }
          />
          {sr.supported && (
            // Push-to-talk within the composer. Hands-free voice MODE is toggled from the Atria core
            // (the single, persistent control — P1), so the redundant composer toggle is gone.
            <button
              type="button"
              className={`composer-mic ${sr.listening ? 'is-listening' : ''}`}
              onClick={micClick}
              title={sr.listening ? t('orchestrate.mic.stop_listening') : t('orchestrate.mic.talk')}
              aria-label={sr.listening ? t('orchestrate.mic.stop_listening') : t('orchestrate.mic.speak')}
            >{sr.listening ? '■' : '🎤'}</button>
          )}
          <button
            className={`composer-send ${busy ? 'loading' : ''}`}
            disabled={busy}
            onClick={() => void start(input)}
            aria-label={busy ? t('orchestrate.send.working') : t('orchestrate.send.send')}
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
});
