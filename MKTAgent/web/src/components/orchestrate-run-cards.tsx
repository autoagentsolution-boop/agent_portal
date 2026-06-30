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

export function PlanCard({ run, busy, defaultName, onSave }: PlanProps) {
  const [name, setName] = useState('');
  // Already saved → show its name as a confirmation, not the form again.
  const savedName = run.name ?? null;

  return (
    <div className="dag-block run-card">
      <div className="eyebrow">Workflow plan · {run.nodes.length} step(s)</div>
      <RunDagView nodes={run.nodes} />

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
        <p className="muted small saved-confirm">✓ Saved as “{savedName}” — open Active Flows to execute.</p>
      )}
    </div>
  );
}
