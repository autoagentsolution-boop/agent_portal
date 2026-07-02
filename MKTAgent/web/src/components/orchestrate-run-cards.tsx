// In-chat plan card for the Orchestrate surface. Shows the planned DAG (so the user
// sees which agents will run) and the SAVE action: name the flow → it's persisted to
// Saved Flows and the user is handed off to Active Flows to execute it. No execution,
// no raw artifacts here — those live in Active Flows after the flow runs. Clarification
// is conversational now (the assistant bubble asks), so there is no question form.
import { useState } from 'react';
import type { WorkflowRunDto } from '../api/client';
import { RunDagView } from './run-dag-view';

interface PlanProps {
  run: WorkflowRunDto;
  busy: boolean;
  defaultName: string;
  onSave: (name: string) => void;
}

// Selected publish targets, read off the goal so the plan card shows WHERE this will
// publish (the "publisher hides the chosen platforms" gap). Empty → nothing rendered.
const goalPlatforms = (run: WorkflowRunDto): string[] => {
  const p = (run.goal as { platforms?: unknown } | null)?.platforms;
  return Array.isArray(p) ? (p as string[]) : [];
};

const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn', x: 'X',
};

export function PlanCard({ run, busy, defaultName, onSave }: PlanProps) {
  const [name, setName] = useState('');
  // Already saved → show its name as a confirmation, not the form again.
  const savedName = run.name ?? null;
  const platforms = goalPlatforms(run);

  return (
    <div className="dag-block run-card">
      <div className="eyebrow">Workflow plan · {run.nodes.length} step(s)</div>
      {platforms.length > 0 && (
        <div className="plan-platforms">
          <span className="muted small">Publishes to:</span>
          {platforms.map((p) => (
            <span className="platform-chip" key={p}>{PLATFORM_LABEL[p] ?? p}</span>
          ))}
        </div>
      )}
      <RunDagView nodes={run.nodes} platforms={platforms} />

      {run.status === 'planned' && !savedName && (
        <div className="save-flow">
          <p className="muted small">Looks right? Name this flow to save it — you'll run it from Active Flows. You can still add or remove steps by typing below (e.g. “thêm video”, “bỏ infographic”).</p>
          <div className="save-flow-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName ? `e.g. ${defaultName} campaign` : 'Name this flow'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (name.trim() || defaultName)) onSave((name.trim() || defaultName)); }}
            />
            <button className="btn primary" disabled={busy} onClick={() => onSave(name.trim() || defaultName || 'Untitled flow')}>
              {busy ? 'Saving…' : 'Save & open in Active Flows'}
            </button>
          </div>
        </div>
      )}

      {savedName && (
        <p className="muted small saved-confirm">✓ Saved as “{savedName}”.</p>
      )}
    </div>
  );
}

interface OfferProps {
  busy: boolean;
  onSetupCampaign: () => void;
  onRunTest: () => void;
  onOpenFlow: () => void;
}

// P6 — the "flow saved, what next?" card. The Master Agent's guiding prose is rendered
// as the preceding assistant bubble; this card carries the three concrete actions.
// Set up campaign = $0 (create the container, begin strategy). Run a test post = executes
// the DAG (image-gen spend, publisher still gated). Open flow = just redirect, no action.
export function SaveOfferCard({ busy, onSetupCampaign, onRunTest, onOpenFlow }: OfferProps) {
  return (
    <div className="save-offer">
      <button className="btn primary" disabled={busy} onClick={onSetupCampaign}>Set up first campaign</button>
      <button className="btn" disabled={busy} onClick={onRunTest}>Run a test post</button>
      <button className="btn ghost" disabled={busy} onClick={onOpenFlow}>Just open the flow</button>
    </div>
  );
}
