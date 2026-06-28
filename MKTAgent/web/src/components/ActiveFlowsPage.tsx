import { useState } from 'react';
import { DemoModeToggle } from './DemoModeToggle';
import { PostBoard } from './PostBoard';
import { brandingVideoFlow, type DemoMode, type FlowAgentNode } from '../flow/demo-flow';
import type { PostDto } from '../api/client';

interface Props {
  activeCampaign: string | null;
  demoMode: DemoMode;
  refreshKey: number;
  selectedPostId: string | null;
  onCampaignSelect: (id: string | null) => void;
  onDemoModeChange: (mode: DemoMode) => void;
  onRefresh: () => void;
  onPostsChange: (posts: PostDto[]) => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const credentialNeeds: Record<string, string[]> = {
  'content-research': ['Optional: source URLs, audience notes, niche examples'],
  'concept-writer': ['GEMINI_API_KEY for live copy generation', 'Campaign language + tone + angle'],
  infographic: ['Design provider credentials later', 'Brand visual references'],
  storyboard: ['Video Farm storyboard pipeline access'],
  'voice-video': ['Video provider credentials', 'TTS/music provider credentials'],
  publisher: ['Connected social OAuth tokens', 'Drive media file IDs', 'Safe/Live publish confirmation'],
};

function AgentDetail({ agent, onClose }: { agent: FlowAgentNode; onClose: () => void }) {
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
    </div>
  );
}

export function ActiveFlowsPage(props: Props) {
  const [selectedAgent, setSelectedAgent] = useState<FlowAgentNode | null>(null);

  const toggleAgent = (node: FlowAgentNode) =>
    setSelectedAgent((current) => current?.id === node.id ? null : node);

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

      {selectedAgent && <AgentDetail agent={selectedAgent} onClose={() => setSelectedAgent(null)} />}

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
