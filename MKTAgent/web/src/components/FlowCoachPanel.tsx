import { brandingVideoFlow } from '../flow/demo-flow';

const recommendations = [
  'Use the full Branding / Social Video Flow for investor demo storytelling.',
  'Run Content Agent live; keep media nodes visible as integration roadmap.',
  'Use Safe mode for repeated demos; Live only for one controlled DAIS publish.',
];

const missing = [
  { label: 'Source/reference content', state: 'Ask user or let Find Content Agent gather it' },
  { label: 'Visual style system', state: 'Will be forked from user design tomorrow' },
  { label: 'Publish mode', state: 'Safe by default; Live requires confirmation' },
];

export function FlowCoachPanel() {
  return (
    <aside className="coach card">
      <div className="eyebrow">Master Agent / Flow Coach</div>
      <h3>Recommended workflow</h3>
      <p className="muted">I will collect missing context, suggest agents, and route artifacts through approval gates.</p>

      <div className="section-title">Required inputs</div>
      <ul className="check-list">
        {brandingVideoFlow.requiredInputs.map((item) => <li key={item}>✓ {item}</li>)}
      </ul>

      <div className="section-title">Demo guidance</div>
      <ul className="plain-list">
        {recommendations.map((item) => <li key={item}>{item}</li>)}
      </ul>

      <div className="section-title">Still needed</div>
      {missing.map((m) => (
        <div className="missing-item" key={m.label}>
          <strong>{m.label}</strong>
          <span>{m.state}</span>
        </div>
      ))}
    </aside>
  );
}
