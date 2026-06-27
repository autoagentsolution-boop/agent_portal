import { brandingVideoFlow, type AgentStatus, type FlowAgentNode } from '../flow/demo-flow';
import type { PostDto } from '../api/client';
import { nodeState } from '../flow/run-state';

interface Props {
  posts: PostDto[];
}

export function FlowCanvas({ posts }: Props) {
  return (
    <section className="flow-canvas card">
      <div className="spread">
        <div>
          <div className="eyebrow">Flow canvas</div>
          <h3>{brandingVideoFlow.title}</h3>
        </div>
        <span className="badge ready">API-first demo</span>
      </div>
      <div className="flow-line">
        {brandingVideoFlow.nodes.map((node, i) => (
          <FlowNode key={node.id} node={node} state={nodeState(node.id, posts)} isLast={i === brandingVideoFlow.nodes.length - 1} />
        ))}
      </div>
    </section>
  );
}

function FlowNode({ node, state, isLast }: { node: FlowAgentNode; state: string; isLast: boolean }) {
  return (
    <div className="flow-node-wrap">
      <div className={`flow-node ${state} ${node.status}`}>
        <div className="spread">
          <strong>{node.title}</strong>
          <StatusBadge status={node.status} />
        </div>
        <p>{node.subtitle}</p>
        <div className="node-meta">
          <span>{node.mode}</span>
          <span>{state}</span>
        </div>
        <div className="node-output">Output: {node.output}</div>
        <div className="node-capability">{node.currentCapability}</div>
      </div>
      {!isLast && <div className="node-arrow">↓</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const label = status === 'live' ? 'Live' : status === 'existing' ? 'Existing' : 'Planned';
  return <span className={`agent-status ${status}`}>{label}</span>;
}
