// Active Flows workspace. Three real states, no static demo:
//   1. A Saved Flow is selected  → SavedFlowDetail (real run: DAG, execute, gate, node setup).
//   2. A campaign is selected     → its PostBoard (briefs/posts).
//   3. Nothing selected           → empty-state that routes flow creation into Orchestrate chat.
// The old hardcoded brandingVideoFlow template + its fake agent-strip/AgentDetail are retired;
// per-agent credential setup now lives on REAL flow nodes inside SavedFlowDetail.
import { DemoModeToggle } from './DemoModeToggle';
import { PostBoard } from './PostBoard';
import { SavedFlowDetail } from './saved-flow-detail';
import type { PostDto } from '../api/client';
import type { DemoMode } from '../flow/demo-flow';

interface Props {
  activeCampaign: string | null;
  demoMode: DemoMode;
  refreshKey: number;
  selectedPostId: string | null;
  selectedRunId: string | null;
  onDemoModeChange: (mode: DemoMode) => void;
  onRefresh: () => void;
  onPostsChange: (posts: PostDto[]) => void;
  onNewFlow: () => void;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

export function ActiveFlowsPage(props: Props) {
  // A selected Saved Flow takes over with its real run detail (DAG + execute + node setup).
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

  // A selected campaign shows its briefs. No flow chrome — a campaign lives under a flow
  // but is edited on its own board.
  if (props.activeCampaign || props.selectedPostId) {
    return (
      <div className="active-flow-workspace">
        <div className="active-flow-header card compact">
          <div>
            <div className="eyebrow">Campaign</div>
            <p className="muted small">Review and edit this campaign's briefs. Publishing respects the mode on the right.</p>
          </div>
          <DemoModeToggle mode={props.demoMode} onChange={props.onDemoModeChange} />
        </div>
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

  // Nothing selected → route flow creation into the Master Agent chat. Manual node-graph
  // assembly is a future feature; today every flow is born by describing intent.
  return (
    <div className="active-flow-workspace">
      <div className="flows-empty card">
        <div className="eyebrow">Flows</div>
        <h2>Start a new flow</h2>
        <p className="muted">
          Describe what you want to create and the Master Agent plans the flow for you —
          content, visuals, video and publishing. No manual wiring.
        </p>
        <button className="btn primary" onClick={props.onNewFlow}>✎ Create a flow → opens chat</button>
      </div>
    </div>
  );
}
