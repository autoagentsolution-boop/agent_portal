import type { DemoMode } from '../flow/demo-flow';
import { brandingVideoFlow } from '../flow/demo-flow';
import type { PostDto } from '../api/client';
import { flowRunSummary } from '../flow/run-state';

interface Props {
  userEmail: string;
  demoMode: DemoMode;
  posts: PostDto[];
}

export function WorkspaceHero({ userEmail, demoMode, posts }: Props) {
  const summary = flowRunSummary(posts);
  return (
    <section className="workspace-hero">
      <div>
        <div className="eyebrow">AgentPortal Workspace</div>
        <h2>{brandingVideoFlow.title}</h2>
        <p>{brandingVideoFlow.promise}</p>
        <div className="hero-meta">
          <span>{userEmail}</span>
          <span>{demoMode === 'safe' ? 'Safe simulation' : 'Live publish enabled'}</span>
          <span>{brandingVideoFlow.audience}</span>
        </div>
      </div>
      <div className="metric-row">
        <Metric label="Needs input" value={summary.needsInput} />
        <Metric label="Review" value={summary.waitingReview} />
        <Metric label="Ready" value={summary.ready} />
        <Metric label="Live" value={summary.live} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
