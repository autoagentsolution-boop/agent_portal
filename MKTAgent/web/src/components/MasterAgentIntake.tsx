import { useState } from 'react';
import { api, type AgentIntakeDraft, type CampaignDto, type Dto } from '../api/client';
import { assetTypeOptions, languageOptions, lengthOptions, type AssetType } from './form-options';
import { PlatformChecklist } from './PlatformChecklist';

interface Props {
  onCreated: (campaign: CampaignDto) => void;
  onOpenFlows: () => void;
  onChatTitle: (title: string) => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

type ChatMessage = { role: 'agent' | 'user'; text: string };
const samplePrompt = 'Tạo campaign tiếng Việt cho khóa AI Agent, tone chuyên gia nhưng gần gũi, post dài, đăng Facebook + Threads, dùng video, lịch mai 9h sáng, angle là giúp chủ doanh nghiệp tiết kiệm thời gian vận hành.';
const promptChips = ['Find my best niche', 'Create a social video flow', 'Write or edit a campaign', 'Schedule a post'];

const canCreate = (draft: AgentIntakeDraft | null): draft is AgentIntakeDraft & { campaign: Dto['CreateCampaignBody'] } =>
  Boolean(draft?.campaign.product?.trim());
const display = (v: unknown): string => Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v ? String(v) : '—');
const isDiscoveryPrompt = (text: string): boolean =>
  /find.*niche|best niche|what niche|choose.*niche|tìm.*ngách|ngách.*nào/i.test(text);
const discoveryReply = `Good starting point. Before I create a flow, I need to understand your market fit.

1. Who do you want to sell to? (business owners, creators, coaches, clinics, schools, etc.)
2. What do you already have? (product, service, audience, content assets, proof/results)
3. What is the goal for this campaign? (leads, bookings, followers, launch, authority)
4. Which channels matter first? (Facebook, Threads, Instagram, LinkedIn, X)

Reply with rough notes. I will turn that into a recommended flow and setup draft.`;


export function MasterAgentIntake({ onCreated, onOpenFlows, onChatTitle, notify }: Props) {
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<AgentIntakeDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const hasStarted = messages.length > 0 || Boolean(draft);

  const updateCampaign = <K extends keyof AgentIntakeDraft['campaign']>(key: K, value: AgentIntakeDraft['campaign'][K]) =>
    setDraft((prev) => prev ? { ...prev, campaign: { ...prev.campaign, [key]: value } } : prev);
  const updatePost = <K extends keyof AgentIntakeDraft['post']>(key: K, value: AgentIntakeDraft['post'][K]) =>
    setDraft((prev) => prev ? { ...prev, post: { ...prev.post, [key]: value } } : prev);

  const analyze = async (text = input.trim()) => {
    if (text.length < 10) { notify('Describe the campaign in one sentence or more', 'err'); return; }
    onChatTitle(text.slice(0, 42));
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    if (isDiscoveryPrompt(text)) {
      setDraft(null);
      setMessages((prev) => [...prev, { role: 'agent', text: discoveryReply }]);
      return;
    }
    setBusy('parse');
    const r = await api.parseMasterIntake(text);
    setBusy(null);
    if (!r.ok) { notify(`Master Agent failed: ${r.error.error}`, 'err'); return; }
    setDraft(r.data);
    setEditing(false);
    onChatTitle(r.data.campaign.product ?? text.slice(0, 42));
    setMessages((prev) => [...prev, {
      role: 'agent',
      text: r.data.missingFields.length
        ? `I selected ${r.data.selectedTemplateTitle}, but I need a few more details before creating the draft.\n\n${r.data.nextQuestion}`
        : `I selected ${r.data.selectedTemplateTitle}. The setup is ready to draft.`,
    }]);
  };

  const createDraft = async () => {
    if (!canCreate(draft)) { notify('Product / offer is required before creating a draft', 'err'); return; }
    setBusy('create');
    const campaignResult = await api.createCampaign(draft.campaign);
    if (!campaignResult.ok) { setBusy(null); notify(`Create campaign failed: ${campaignResult.error.error}`, 'err'); return; }
    const postResult = await api.createPost({ campaignId: campaignResult.data.id, ...draft.post });
    setBusy(null);
    if (!postResult.ok) notify(`Campaign created, but post draft failed: ${postResult.error.error}`, 'err');
    else notify('Master Agent created campaign + post brief');
    onCreated(campaignResult.data);
    onOpenFlows();
  };

  return (
    <section className={`master-chat-main ${hasStarted ? 'started' : ''}`}>
      {!hasStarted && (
        <div className="empty-chat-hero">
          <h1>Where should we begin?</h1>
          <p>Describe your niche, offer, language, media type and schedule. Master Agent will select the flow and lock the setup.</p>
        </div>
      )}

      {hasStarted && (
        <div className="chat-transcript">
          {messages.map((m, i) => <div key={`${m.role}-${i}`} className={`chat-bubble ${m.role}`}>{m.text}</div>)}
          {busy === 'parse' && <div className="chat-bubble agent">Analyzing niche, offer, language, media and schedule…</div>}
        </div>
      )}

      {draft && (
        <div className="locked-setup">
          <div className="spread">
            <div>
              <div className="eyebrow">Setup summary</div>
              <strong>{draft.selectedTemplateTitle}</strong>
              <p className="muted small">Confidence {Math.round(draft.confidence * 100)}% · {draft.provider}</p>
            </div>
            <button className="btn" onClick={() => setEditing((v) => !v)}>{editing ? 'Hide edit' : 'Edit fields'}</button>
          </div>

          {!editing ? (
            <div className="setup-summary-grid">
              <div><strong>Product</strong><span>{display(draft.campaign.product)}</span></div>
              <div><strong>Language</strong><span>{display(draft.campaign.language)}</span></div>
              <div><strong>Angle</strong><span>{display(draft.campaign.angle)}</span></div>
              <div><strong>Tone</strong><span>{display(draft.campaign.brandVoice)}</span></div>
              <div><strong>Platforms</strong><span>{display(draft.campaign.platforms)}</span></div>
              <div><strong>Asset</strong><span>{display(draft.post.assetType)}</span></div>
            </div>
          ) : (
            <div className="edit-fields-panel">
              <div className="form-grid two">
                <div className="field"><label>Product</label><input value={draft.campaign.product ?? ''} onChange={(e) => updateCampaign('product', e.target.value)} /></div>
                <div className="field"><label>Language</label><select value={draft.campaign.language ?? ''} onChange={(e) => { updateCampaign('language', e.target.value); updatePost('language', e.target.value); }}>{languageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <div className="field"><label>Angle</label><textarea value={draft.campaign.angle ?? ''} onChange={(e) => updateCampaign('angle', e.target.value)} /></div>
              <div className="form-grid two">
                <div className="field"><label>Tone</label><textarea value={draft.campaign.brandVoice ?? ''} onChange={(e) => updateCampaign('brandVoice', e.target.value)} /></div>
                <div className="field"><label>Length</label><select value={draft.campaign.defaultLength ?? ''} onChange={(e) => { updateCampaign('defaultLength', e.target.value); updatePost('lengthSpec', e.target.value); }}>{lengthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <div className="field"><label>Platforms</label><PlatformChecklist value={draft.campaign.platforms ?? []} onChange={(v) => { updateCampaign('platforms', v); updatePost('platforms', v); }} /></div>
              <div className="form-grid two">
                <div className="field"><label>Asset type</label><select value={draft.post.assetType ?? ''} onChange={(e) => updatePost('assetType', e.target.value as AssetType)}>{assetTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div className="field"><label>Hero file ID(s)</label><input value={draft.post.heroFile ?? ''} onChange={(e) => updatePost('heroFile', e.target.value)} /></div>
              </div>
            </div>
          )}

          {draft.missingFields.length > 0 && <div className="setup-gates">{draft.missingFields.map((m) => <div className="missing-item" key={m.key}><strong>{m.required ? 'Required: ' : 'Recommended: '}{m.label}</strong><span>{m.reason}</span></div>)}</div>}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!canCreate(draft) || busy === 'create'} onClick={() => void createDraft()}>{busy === 'create' ? 'Creating…' : 'Create draft + open Active Flows'}</button>
            <button className="btn" onClick={onOpenFlows}>Open Active Flows</button>
          </div>
        </div>
      )}

      <div className="floating-composer">
        <div className="composer-box">
          <button className="composer-plus" aria-label="Attach or add context">+</button>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Master Agent to set up your marketing flow…" />
          <button className="composer-send" disabled={busy === 'parse'} onClick={() => void analyze()} aria-label="Send">{busy === 'parse' ? '…' : '↑'}</button>
        </div>
        <div className="prompt-chip-row">
          {promptChips.map((chip) => <button className="prompt-chip" key={chip} onClick={() => setInput(chip === 'Create a social video flow' ? samplePrompt : chip)}>{chip}</button>)}
        </div>
      </div>
    </section>
  );
}
