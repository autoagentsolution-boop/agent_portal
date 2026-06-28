import { useState } from 'react';
import { api, type AgentChatSessionDto, type AgentIntakeDraft, type CampaignDto, type Dto } from '../api/client';
import { assetTypeOptions, languageOptions, lengthOptions, type AssetType } from './form-options';
import { PlatformChecklist } from './PlatformChecklist';

interface Props {
  session: AgentChatSessionDto | null;
  onSessionChange: (session: AgentChatSessionDto) => void;
  onCreated: (campaign: CampaignDto) => void;
  onOpenFlows: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const samplePrompt = 'Tạo campaign tiếng Việt cho khóa AI Agent, tone chuyên gia nhưng gần gũi, post dài, đăng Facebook + Threads, dùng video, lịch mai 9h sáng, angle là giúp chủ doanh nghiệp tiết kiệm thời gian vận hành.';
const promptChips = ['Find my best niche', 'Create a social video flow', 'Write or edit a campaign', 'Schedule a post'];

const canCreate = (draft: AgentIntakeDraft | null): draft is AgentIntakeDraft & { campaign: Dto['CreateCampaignBody'] } =>
  Boolean(draft?.campaign.product?.trim());

const display = (value: unknown): string => {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return value ? String(value) : '—';
};

export function MasterAgentIntake({ session, onSessionChange, onCreated, onOpenFlows, notify }: Props) {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const messages = session?.messages ?? [];
  const visibleMessages = pendingMessage
    ? [...messages, { id: 'pending-user-message', role: 'user' as const, content: pendingMessage, createdAt: '' }]
    : messages;
  const draft = session?.draft ?? null;
  const hasStarted = visibleMessages.length > 0 || Boolean(draft) || busy === 'parse';

  const updateDraft = (next: AgentIntakeDraft) => {
    if (!session) return;
    onSessionChange({ ...session, draft: next });
  };

  const updateCampaign = <K extends keyof AgentIntakeDraft['campaign']>(key: K, value: AgentIntakeDraft['campaign'][K]) => {
    if (draft) updateDraft({ ...draft, campaign: { ...draft.campaign, [key]: value } });
  };

  const updatePost = <K extends keyof AgentIntakeDraft['post']>(key: K, value: AgentIntakeDraft['post'][K]) => {
    if (draft) updateDraft({ ...draft, post: { ...draft.post, [key]: value } });
  };

  const analyze = async (text = input.trim()) => {
    if (text.length < 2) {
      notify('Ask Master Agent something first', 'err');
      return;
    }

    setInput('');
    setPendingMessage(text);
    setBusy('parse');

    try {
      const result = session
        ? await api.appendAgentChatMessage(session.id, text)
        : await api.createAgentChat(text.slice(0, 80), text);

      if (!result.ok) {
        notify(`Master Agent failed: ${result.error.error}`, 'err');
        return;
      }

      onSessionChange(result.data);
      setEditing(false);
    } catch (error) {
      notify(`Master Agent failed: ${error instanceof Error ? error.message : 'request_failed'}`, 'err');
    } finally {
      setPendingMessage(null);
      setBusy(null);
    }
  };

  const createDraft = async () => {
    if (!canCreate(draft)) {
      notify('Product / offer is required before creating a draft', 'err');
      return;
    }

    setBusy('create');
    const campaignResult = await api.createCampaign(draft.campaign);
    if (!campaignResult.ok) {
      setBusy(null);
      notify(`Create campaign failed: ${campaignResult.error.error}`, 'err');
      return;
    }

    const postResult = await api.createPost({ campaignId: campaignResult.data.id, ...draft.post });
    setBusy(null);
    if (!postResult.ok) notify(`Campaign created, but post draft failed: ${postResult.error.error}`, 'err');
    else notify('Master Agent created campaign + post brief');
    onCreated(campaignResult.data);
    onOpenFlows();
  };

  const applyPromptChip = (chip: string) => {
    setInput(chip === 'Create a social video flow' ? samplePrompt : chip);
  };

  return (
    <section className={`master-chat-main ${hasStarted ? 'started' : ''}`}>
      {!hasStarted && (
        <div className="empty-chat-hero">
          <h1>Where should we begin?</h1>
          <p>
            Ask anything about niche, offer, audience, content angle or campaign setup.
            Master Agent will reason first, then create a draft only when concrete details exist.
          </p>
        </div>
      )}

      {hasStarted && (
        <div className="chat-transcript">
          {visibleMessages.map((message) => (
            <div key={message.id} className={`chat-bubble ${message.role}`}>{message.content}</div>
          ))}
          {busy === 'parse' && (
            <div className="chat-bubble agent thinking-bubble" role="status" aria-live="polite">
              <span className="thinking-copy">Thinking</span>
              <span className="thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
        </div>
      )}

      {draft && canCreate(draft) && (
        <div className="locked-setup">
          <div className="spread">
            <div>
              <div className="eyebrow">Setup summary</div>
              <strong>{draft.selectedTemplateTitle}</strong>
              <p className="muted small">Confidence {Math.round(draft.confidence * 100)}% · {draft.provider}</p>
            </div>
            <button className="btn" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Hide edit' : 'Edit fields'}
            </button>
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
                <div className="field">
                  <label>Product</label>
                  <input value={draft.campaign.product ?? ''} onChange={(event) => updateCampaign('product', event.target.value)} />
                </div>
                <div className="field">
                  <label>Language</label>
                  <select
                    value={draft.campaign.language ?? ''}
                    onChange={(event) => {
                      updateCampaign('language', event.target.value);
                      updatePost('language', event.target.value);
                    }}
                  >
                    {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Angle</label>
                <textarea value={draft.campaign.angle ?? ''} onChange={(event) => updateCampaign('angle', event.target.value)} />
              </div>

              <div className="form-grid two">
                <div className="field">
                  <label>Tone</label>
                  <textarea value={draft.campaign.brandVoice ?? ''} onChange={(event) => updateCampaign('brandVoice', event.target.value)} />
                </div>
                <div className="field">
                  <label>Length</label>
                  <select
                    value={draft.campaign.defaultLength ?? ''}
                    onChange={(event) => {
                      updateCampaign('defaultLength', event.target.value);
                      updatePost('lengthSpec', event.target.value);
                    }}
                  >
                    {lengthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Platforms</label>
                <PlatformChecklist
                  value={draft.campaign.platforms ?? []}
                  onChange={(value) => {
                    updateCampaign('platforms', value);
                    updatePost('platforms', value);
                  }}
                />
              </div>

              <div className="form-grid two">
                <div className="field">
                  <label>Asset type</label>
                  <select value={draft.post.assetType ?? ''} onChange={(event) => updatePost('assetType', event.target.value as AssetType)}>
                    {assetTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Hero file ID(s)</label>
                  <input value={draft.post.heroFile ?? ''} onChange={(event) => updatePost('heroFile', event.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy === 'create'} onClick={() => void createDraft()}>
              {busy === 'create' ? 'Creating…' : 'Create draft + open Active Flows'}
            </button>
            <button className="btn" onClick={onOpenFlows}>Open Active Flows</button>
          </div>
        </div>
      )}

      <div className="floating-composer">
        <div className="composer-box">
          <button className="composer-plus" aria-label="Attach or add context">+</button>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Master Agent to reason, plan or set up your marketing flow…"
          />
          <button
            className={`composer-send ${busy === 'parse' ? 'loading' : ''}`}
            disabled={busy === 'parse'}
            onClick={() => void analyze()}
            aria-label={busy === 'parse' ? 'Master Agent is thinking' : 'Send'}
          >
            {busy === 'parse' ? '…' : '↑'}
          </button>
        </div>
        <div className="prompt-chip-row">
          {promptChips.map((chip) => (
            <button className="prompt-chip" key={chip} onClick={() => applyPromptChip(chip)}>{chip}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
