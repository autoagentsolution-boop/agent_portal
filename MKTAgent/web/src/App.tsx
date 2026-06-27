import { useState } from 'react';
import { useAuth } from './hooks/use-auth';
import { useToast } from './hooks/use-toast';
import { loginUrl } from './api/client';
import { CampaignList } from './components/CampaignList';
import { PostBoard } from './components/PostBoard';

export function App() {
  const auth = useAuth();
  const { toast, show } = useToast();
  const [activeCampaign, setActiveCampaign] = useState<string | null>(null);
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
        <h1>MKTAgent</h1>
        <div className="who">
          <span>{auth.user.email}</span>
          <span className="badge brief">{auth.user.accountType}</span>
          <button className="btn" onClick={() => void auth.logout()}>Logout</button>
        </div>
      </div>
      <div className="layout">
        <div className="sidebar">
          <CampaignList
            key={`camp-${refreshKey}`}
            activeId={activeCampaign}
            onSelect={setActiveCampaign}
            onChange={bump}
            notify={show}
          />
        </div>
        <div className="main">
          <PostBoard
            key={`posts-${activeCampaign}-${refreshKey}`}
            campaignId={activeCampaign}
            ownerId={auth.user.id}
            notify={show}
          />
        </div>
      </div>
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
