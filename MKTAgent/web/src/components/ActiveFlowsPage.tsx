import { useEffect, useMemo, useState } from 'react';
import { DemoModeToggle } from './DemoModeToggle';
import { PostBoard } from './PostBoard';
import { SavedFlowDetail } from './saved-flow-detail';
import { api, type AgentCredentialStatusDto, type PostDto } from '../api/client';
import { brandingVideoFlow, type DemoMode, type FlowAgentNode } from '../flow/demo-flow';

interface Props {
  activeCampaign: string | null;
  demoMode: DemoMode;
  refreshKey: number;
  selectedPostId: string | null;
  selectedRunId: string | null;
  onCampaignSelect: (id: string | null) => void;
  onDemoModeChange: (mode: DemoMode) => void;
  onRefresh: () => void;
  onPostsChange: (posts: PostDto[]) => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const credentialNeeds: Record<string, string[]> = {
  'content-research': ['Optional: source URLs, audience notes, niche examples'],
  'concept-writer': ['Campaign language + tone + angle'],
  infographic: ['Brand visual references'],
  storyboard: ['Video Farm storyboard pipeline access'],
  'voice-video': ['Video generation + voice/music provider access'],
  publisher: ['Connected social OAuth tokens', 'Drive media file IDs', 'Safe/Live publish confirmation'],
};

const credentialFields: Record<string, Array<{ key: string; label: string; help: string }>> = {
  'concept-writer': [
    { key: 'gemini_api_key', label: 'Gemini API key', help: 'Used by copy/concept generation. Stored encrypted; never shown again.' },
  ],
  infographic: [
    { key: 'design_provider_key', label: 'Design provider API key', help: 'Provider key for design/image generation.' },
    { key: 'design_client_id', label: 'Design client ID', help: 'Optional if the design provider uses OAuth/app credentials.' },
    { key: 'design_client_secret', label: 'Design client secret', help: 'Optional app secret. Store only if this workspace owns the provider app.' },
  ],
  storyboard: [
    { key: 'storyboard_provider_key', label: 'Storyboard provider key', help: 'Future bridge to the storyboard pipeline.' },
  ],
  'voice-video': [
    { key: 'video_provider_key', label: 'Video provider API key', help: 'Video model/provider access.' },
    { key: 'video_client_id', label: 'Video client ID', help: 'Optional if the video provider uses OAuth/app credentials.' },
    { key: 'video_client_secret', label: 'Video client secret', help: 'Optional app secret. Store only if this workspace owns the provider app.' },
    { key: 'tts_music_provider_key', label: 'TTS / music provider key', help: 'Voiceover and music generation access.' },
  ],
  publisher: [
    { key: 'google_client_id', label: 'Google client ID', help: 'For Drive/Gmail/YouTube app access when using workspace-owned Google OAuth.' },
    { key: 'google_client_secret', label: 'Google client secret', help: 'Google OAuth app secret. Stored encrypted; never shown again.' },
    { key: 'google_refresh_token', label: 'Google refresh token', help: 'Long-lived Google token for Drive/Gmail/YouTube operations.' },
    { key: 'facebook_app_id', label: 'Facebook app ID', help: 'Meta app ID for OAuth/content publishing setup.' },
    { key: 'facebook_app_secret', label: 'Facebook app secret', help: 'Meta app secret. Store only for workspace-owned apps.' },
    { key: 'facebook_page_id', label: 'Facebook page ID', help: 'Target Page ID for Facebook publishing.' },
    { key: 'facebook_access_token', label: 'Facebook page access token', help: 'Page access token. Prefer OAuth connect flow for production.' },
    { key: 'instagram_app_id', label: 'Instagram app ID', help: 'Meta/Instagram app ID for publishing setup.' },
    { key: 'instagram_app_secret', label: 'Instagram app secret', help: 'Meta app secret. Store only for workspace-owned apps.' },
    { key: 'instagram_business_account_id', label: 'Instagram business account ID', help: 'Target IG Business account/user ID.' },
    { key: 'instagram_access_token', label: 'Instagram access token', help: 'IG publishing token. Prefer OAuth connect flow for production.' },
    { key: 'threads_app_id', label: 'Threads app ID', help: 'Threads API app ID.' },
    { key: 'threads_app_secret', label: 'Threads app secret', help: 'Threads API app secret.' },
    { key: 'threads_access_token', label: 'Threads access token', help: 'Threads publishing token.' },
    { key: 'linkedin_client_id', label: 'LinkedIn client ID', help: 'LinkedIn OAuth app client ID.' },
    { key: 'linkedin_client_secret', label: 'LinkedIn client secret', help: 'LinkedIn OAuth app secret.' },
    { key: 'linkedin_access_token', label: 'LinkedIn access token', help: 'LinkedIn member/page access token.' },
    { key: 'linkedin_author_urn', label: 'LinkedIn author URN', help: 'Target person or organization URN.' },
    { key: 'x_client_id', label: 'X client ID', help: 'X OAuth app client ID.' },
    { key: 'x_client_secret', label: 'X client secret', help: 'X OAuth app secret if configured as confidential client.' },
    { key: 'x_access_token', label: 'X access token', help: 'X posting token.' },
    { key: 'x_refresh_token', label: 'X refresh token', help: 'X refresh token for token renewal.' },
  ],
};

type CredentialValues = Record<string, string>;

function AgentDetail({
  agent,
  credentials,
  values,
  savingKey,
  onClose,
  onValueChange,
  onSave,
  onDelete,
}: {
  agent: FlowAgentNode;
  credentials: Map<string, AgentCredentialStatusDto>;
  values: CredentialValues;
  savingKey: string | null;
  onClose: () => void;
  onValueChange: (key: string, value: string) => void;
  onSave: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  return (
    <div className="card compact agent-detail-panel">
      <div className="spread">
        <div>
          <div className="eyebrow">Agent detail</div>
          <h3>{agent.title}</h3>
        </div>
        <button className="btn" onClick={onClose}>Hide</button>
      </div>
      <p className="muted small">{agent.subtitle}</p>
      <div className="draft-grid">
        <div><strong>Status</strong><span>{agent.status}</span></div>
        <div><strong>Mode</strong><span>{agent.mode}</span></div>
        <div><strong>Output</strong><span>{agent.output}</span></div>
        <div><strong>Runtime</strong><span>{agent.currentCapability}</span></div>
      </div>
      <div className="section-title">Credential / setup needs</div>
      {(credentialNeeds[agent.id] ?? []).map((need) => <div className="missing-item" key={need}><span>{need}</span></div>)}

      {(credentialFields[agent.id]?.length ?? 0) > 0 && (
        <div className="credential-panel">
          <div className="section-title">Encrypted credential inputs</div>
          {credentialFields[agent.id].map((field) => {
            const status = credentials.get(`${agent.id}:${field.key}`);
            const value = values[field.key] ?? '';
            const busy = savingKey === field.key;
            return (
              <div className="credential-row" key={field.key}>
                <div className="credential-meta">
                  <strong>{field.label}</strong>
                  <span className={`credential-status ${status ? 'active' : 'missing'}`}>{status ? status.status : 'missing'}</span>
                  <p>{field.help}</p>
                </div>
                <div className="credential-actions">
                  <input
                    aria-label={`${field.label} value`}
                    autoComplete="off"
                    placeholder={status ? 'Saved — paste to replace' : 'Paste credential value'}
                    type="password"
                    value={value}
                    onChange={(event) => onValueChange(field.key, event.target.value)}
                  />
                  <button className="btn primary" disabled={busy || value.trim().length === 0} onClick={() => onSave(field.key)}>
                    {busy ? 'Saving…' : status ? 'Replace' : 'Save'}
                  </button>
                  {status && <button className="btn danger" disabled={busy} onClick={() => onDelete(field.key)}>Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ActiveFlowsPage(props: Props) {
  const [selectedAgent, setSelectedAgent] = useState<FlowAgentNode | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<AgentCredentialStatusDto[]>([]);
  const [credentialValues, setCredentialValues] = useState<CredentialValues>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const credentialsByKey = useMemo(() => {
    const map = new Map<string, AgentCredentialStatusDto>();
    for (const credential of credentialStatus) map.set(`${credential.agentId}:${credential.key}`, credential);
    return map;
  }, [credentialStatus]);

  const loadCredentials = async () => {
    const result = await api.listAgentCredentialStatus();
    if (result.ok) setCredentialStatus(result.data);
    else props.notify(`Load credentials failed: ${result.error.error}`, 'err');
  };

  useEffect(() => { void loadCredentials(); }, []);

  const toggleAgent = (node: FlowAgentNode) =>
    setSelectedAgent((current) => current?.id === node.id ? null : node);

  const updateCredentialValue = (key: string, value: string) =>
    setCredentialValues((current) => ({ ...current, [key]: value }));

  const saveCredential = async (key: string) => {
    if (!selectedAgent) return;
    const value = credentialValues[key]?.trim();
    if (!value) return;

    setSavingKey(key);
    const result = await api.saveAgentCredential(selectedAgent.id, key, value);
    setSavingKey(null);

    if (!result.ok) {
      props.notify(`Save credential failed: ${result.error.error}`, 'err');
      return;
    }

    setCredentialValues((current) => ({ ...current, [key]: '' }));
    setCredentialStatus((current) => [result.data, ...current.filter((item) => !(item.agentId === selectedAgent.id && item.key === key))]);
    props.notify('Credential saved encrypted');
  };

  const deleteCredential = async (key: string) => {
    if (!selectedAgent || !confirm('Delete this stored credential?')) return;

    setSavingKey(key);
    const result = await api.deleteAgentCredential(selectedAgent.id, key);
    setSavingKey(null);

    if (!result.ok) {
      props.notify(`Delete credential failed: ${result.error.error}`, 'err');
      return;
    }

    setCredentialStatus((current) => current.filter((item) => !(item.agentId === selectedAgent.id && item.key === key)));
    setCredentialValues((current) => ({ ...current, [key]: '' }));
    props.notify('Credential deleted');
  };

  // A selected Saved Flow takes over the workspace with its real run detail
  // (DAG + execute + per-node output). Otherwise the static demo flow shows.
  if (props.selectedRunId) {
    return (
      <div className="active-flow-workspace">
        <SavedFlowDetail
          key={props.selectedRunId}
          runId={props.selectedRunId}
          notify={props.notify}
          onStatusChange={props.onRefresh}
        />
      </div>
    );
  }

  return (
    <div className="active-flow-workspace">
      <div className="active-flow-header card compact">
        <div>
          <div className="eyebrow">Active Flow</div>
          <h2>{brandingVideoFlow.title}</h2>
          <p className="muted small">Flow active → campaigns → briefs. Click an agent only when you need setup detail.</p>
        </div>
        <DemoModeToggle mode={props.demoMode} onChange={props.onDemoModeChange} />
      </div>

      <div className="agent-strip">
        {brandingVideoFlow.nodes.map((node) => (
          <button
            key={node.id}
            className={`agent-chip ${selectedAgent?.id === node.id ? 'active' : ''}`}
            onClick={() => toggleAgent(node)}
          >
            <strong>{node.title}</strong>
            <span className={`agent-status ${node.status}`}>{node.status}</span>
          </button>
        ))}
      </div>

      {selectedAgent && (
        <AgentDetail
          agent={selectedAgent}
          credentials={credentialsByKey}
          values={credentialValues}
          savingKey={savingKey}
          onClose={() => setSelectedAgent(null)}
          onValueChange={updateCredentialValue}
          onSave={(key) => void saveCredential(key)}
          onDelete={(key) => void deleteCredential(key)}
        />
      )}

      <section className="working-area">
        <PostBoard
          key={`posts-${props.activeCampaign}-${props.refreshKey}-${props.demoMode}`}
          campaignId={props.activeCampaign}
          demoMode={props.demoMode}
          notify={props.notify}
          selectedPostId={props.selectedPostId}
          visiblePostId={props.selectedPostId}
          onPostsChange={props.onPostsChange}
        />
      </section>
    </div>
  );
}
