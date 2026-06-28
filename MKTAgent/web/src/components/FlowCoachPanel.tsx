import { brandingVideoFlow } from '../flow/demo-flow';

const recommendations = [
  'Start with Campaign setup: product, angle, language, tone, audience proof and target channels.',
  'Create a Post brief with media IDs, length, schedule and platform overrides before generating copy.',
  'Reject with specific feedback when copy is weak; Generate again from rework until it is convincing.',
  'Approve with schedule; keep Safe Simulation on until one controlled live publish.',
];

const checkpoints = [
  { label: 'Language', state: 'Campaign default or per-post override is now explicit' },
  { label: 'Tone / brand voice', state: 'Feeds Gemini persona and guardrails' },
  { label: 'Media package', state: 'Paste Drive folder + hero/video/carousel file IDs' },
  { label: 'Schedule', state: 'Approve with an exact publish time or leave ready now' },
];

export function FlowCoachPanel() {
  return (
    <aside className="coach card">
      <div className="eyebrow">Master Agent / Flow Coach</div>
      <h3>Full marketing workflow</h3>
      <p className="muted">Collect the selling context first, then route it through copy-gen, review, rework, schedule and publish.</p>

      <div className="section-title">Required inputs</div>
      <ul className="check-list">
        {brandingVideoFlow.requiredInputs.map((item) => <li key={item}>✓ {item}</li>)}
        <li>✓ Language and post length</li>
        <li>✓ Media attachment: image, carousel or video</li>
        <li>✓ Schedule or publish-now decision</li>
      </ul>

      <div className="section-title">Demo guidance</div>
      <ul className="plain-list">
        {recommendations.map((item) => <li key={item}>{item}</li>)}
      </ul>

      <div className="section-title">Coverage</div>
      {checkpoints.map((m) => (
        <div className="missing-item" key={m.label}>
          <strong>{m.label}</strong>
          <span>{m.state}</span>
        </div>
      ))}
    </aside>
  );
}
