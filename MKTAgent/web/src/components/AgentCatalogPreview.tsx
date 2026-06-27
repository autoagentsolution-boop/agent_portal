import { brandingVideoFlow } from '../flow/demo-flow';

export function AgentCatalogPreview() {
  return (
    <section className="card compact">
      <div className="spread">
        <div>
          <div className="eyebrow">Agent catalog</div>
          <strong>Reusable capabilities</strong>
        </div>
        <button className="btn" title="Roadmap preview only">Request custom agent</button>
      </div>
      <div className="agent-grid">
        {brandingVideoFlow.nodes.map((node) => (
          <div className="agent-card" key={node.id}>
            <span className={`agent-status ${node.status}`}>{node.status}</span>
            <strong>{node.title}</strong>
            <p>{node.output}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
