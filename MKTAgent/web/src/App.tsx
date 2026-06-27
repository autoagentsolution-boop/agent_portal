import { useState } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { loginUrl } from './api/client';
import { CampaignList } from './components/CampaignList';
import { PostBoard } from './components/PostBoard';
import { DemoModeToggle } from './components/DemoModeToggle';
import { WorkspaceHero } from './components/WorkspaceHero';
import { FlowCoachPanel } from './components/FlowCoachPanel';
import { FlowCanvas } from './components/FlowCanvas';
import { AgentCatalogPreview } from './components/AgentCatalogPreview';
import { brandingVideoFlow, type DemoMode } from './flow/demo-flow';
import type { PostDto } from './api/client';

export function App() {
  const auth = useAuth();
  const { toast, show } = useToast();
  const [activeCampaign, setActiveCampaign] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode>('safe');
  const [flowPosts, setFlowPosts] = useState<PostDto[]>([]);
  // Bump to force child reloads after a mutation in another pane.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  if (auth.loading) return <div className="center"><div className="muted">Loading…</div></div>;

  if (!auth.user) {
    return (
      <div className="center">
        <div className="card">
          <h1>MKTAgent</h1>
          <p className="muted">Multi-tenant marketing automation. Sign in to manage campaigns and review posts.</p>
          <a className="btn primary" href={loginUrl()}>Sign in with Google</a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <h1>AgentPortal</h1>
        <div className="who">
          <span>{auth.user.email}</span>
          <span className="badge brief">{auth.user.accountType}</span>
          <button className="btn" onClick={() => void auth.logout()}>Logout</button>
        </div>
      </div>
      <div className="workspace-layout">
        <div className="workspace-left">
          <WorkspaceHero userEmail={auth.user.email} demoMode={demoMode} posts={flowPosts} />
          <FlowCanvas posts={flowPosts} />
          <div className="workspace-grid">
            <FlowCoachPanel />
            <AgentCatalogPreview />
          </div>
        </div>
        <div className="workspace-right">
          <DemoModeToggle mode={demoMode} onChange={setDemoMode} />
          <div className="card compact">
            <div className="eyebrow">Flow template</div>
            <strong>{brandingVideoFlow.title}</strong>
            <p className="muted small">Current runtime maps this template to MKTAgent campaigns/posts. Media nodes are visible roadmap/integration points, not Stitch calls.</p>
          </div>
          <CampaignList
            key={`camp-${refreshKey}`}
            activeId={activeCampaign}
            onSelect={setActiveCampaign}
            onChange={bump}
            notify={show}
          />
        </div>
        <div className="workspace-bottom">
          <PostBoard
            key={`posts-${activeCampaign}-${refreshKey}-${demoMode}`}
            campaignId={activeCampaign}
            demoMode={demoMode}
            notify={show}
            onPostsChange={setFlowPosts}
          />
        </div>
      </div>
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
