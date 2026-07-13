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
  // Approve & run this plan NOW — executes the planned run directly (content is generated, then the run
  // halts at the approval gate before anything publishes/sends). The primary path for a non-technical
  // user who just wants to proceed; saving as a reusable flow is the secondary option.
  onExecute: () => void;
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

// Strategist scope (P2): a plan with the campaign_strategist node drafts a multi-post CALENDAR, not a
// single post. Reading it off the plan lets the chat card say so unmistakably — the fix for "I can't tell
// single vs strategist / can't see how Atria proposes a campaign".
const isStrategistPlan = (run: WorkflowRunDto): boolean => run.nodes.some((n) => n.agentId === 'campaign_strategist');
// An email flow (email_writer/email_agent) is neither a post nor a campaign — label it as such so a
// personal email isn't mislabeled "Single post".
const isEmailPlan = (run: WorkflowRunDto): boolean => run.nodes.some((n) => n.agentId === 'email_writer' || n.agentId === 'email_agent');
const campaignShape = (run: WorkflowRunDto): { weeks: number | null; estPosts: number | null } => {
  const g = run.goal as { duration?: { weeks?: number }; cadence?: { postsPerWeek?: number } } | null;
  const weeks = g?.duration?.weeks ?? null;
  const perWeek = g?.cadence?.postsPerWeek ?? null;
  return { weeks, estPosts: weeks && perWeek ? weeks * perWeek : null };
};

export function PlanCard({ run, busy, defaultName, onSave, onExecute }: PlanProps) {
  const [name, setName] = useState('');
  // Already saved → show its name as a confirmation, not the form again.
  const savedName = run.name ?? null;
  const platforms = goalPlatforms(run);
  const strategist = isStrategistPlan(run);
  const email = !strategist && isEmailPlan(run);
  const { weeks, estPosts } = strategist ? campaignShape(run) : { weeks: null, estPosts: null };

  return (
    <div className="dag-block run-card">
      {strategist ? (
        <div className="plan-scope strategist">
          <strong>🗓 Strategist campaign</strong>
          <span className="muted small">
            Atria will draft {estPosts ? `a ~${estPosts}-post` : 'a multi-post'} content calendar
            {weeks ? ` over ${weeks} week${weeks > 1 ? 's' : ''}` : ''} across your content pillars.
            You review and edit every slot, then approve — nothing schedules until you do.
          </span>
        </div>
      ) : email ? (
        <div className="plan-scope email">
          <strong>✉️ Email</strong>
          <span className="muted small">Atria drafts the email; nothing sends until you review and approve.</span>
        </div>
      ) : (
        <div className="plan-scope single">
          <strong>📄 Single post</strong>
          <span className="muted small">One post, set up end to end.</span>
        </div>
      )}
      <div className="eyebrow">Workflow plan · {run.nodes.length} step(s)</div>
      {platforms.length > 0 && (
        <div className="plan-platforms">
          <span className="muted small">Publishes to:</span>
          {platforms.map((p) => (
            <span className="platform-chip" key={p}>{PLATFORM_LABEL[p] ?? p}</span>
          ))}
        </div>
      )}
      <RunDagView nodes={run.nodes} platforms={platforms} scheduledResumeAt={run.scheduledResumeAt} />

      {run.status === 'planned' && !savedName && (
        <div className="save-flow">
          <div className="plan-run-row">
            <button className="btn primary plan-run-btn" disabled={busy} onClick={onExecute}>
              {busy ? (strategist ? 'Đang lên lịch…' : 'Đang chạy…') : strategist ? '▶ Draft the calendar' : '▶ Duyệt & Chạy ngay'}
            </button>
            <span className="muted small">
              {strategist
                ? <>Atria drafts the calendar right here, then <b>you approve every post</b> before anything schedules.</>
                : <>Atria generates the content, then <b>stops at the review step</b> before publishing/sending.</>}
            </span>
          </div>
          <p className="muted small plan-refine-hint">Muốn chỉnh? Gõ bên dưới (vd “thêm video”, “bỏ infographic”). Hoặc lưu thành flow tái dùng:</p>
          <div className="save-flow-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName ? `e.g. ${defaultName} campaign` : 'Đặt tên flow để lưu'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (name.trim() || defaultName)) onSave((name.trim() || defaultName)); }}
            />
            <button className="btn" disabled={busy} onClick={() => onSave(name.trim() || defaultName || 'Untitled flow')}>
              {busy ? 'Saving…' : 'Lưu thành flow'}
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
