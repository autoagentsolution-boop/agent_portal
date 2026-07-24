// In-chat plan card for the Orchestrate surface. Shows the planned DAG (so the user
// sees which agents will run) and the SAVE action: name the flow → it's persisted to
// Saved Flows and the user is handed off to Active Flows to execute it. No execution,
// no raw artifacts here — those live in Active Flows after the flow runs. Clarification
// is conversational now (the assistant bubble asks), so there is no question form.
import { useState } from 'react';
import type { WorkflowRunDto } from '../api/client';
import { RunDagView } from './run-dag-view';
import { useLocale } from '../i18n';

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
// A utility flow (summarize / security) is neither a post, campaign nor email — a "Single post" label is
// plain wrong for it. Prefer the more specific summarize label when present.
const isSummarizePlan = (run: WorkflowRunDto): boolean => run.nodes.some((n) => n.agentId === 'summarize');
const hasSecurityScan = (run: WorkflowRunDto): boolean => run.nodes.some((n) => n.agentId === 'security');
const campaignShape = (run: WorkflowRunDto): { weeks: number | null; estPosts: number | null } => {
  const g = run.goal as { duration?: { weeks?: number }; cadence?: { postsPerWeek?: number } } | null;
  const weeks = g?.duration?.weeks ?? null;
  const perWeek = g?.cadence?.postsPerWeek ?? null;
  return { weeks, estPosts: weeks && perWeek ? weeks * perWeek : null };
};

export function PlanCard({ run, busy, defaultName, onSave, onExecute }: PlanProps) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  // Already saved → show its name as a confirmation, not the form again.
  const savedName = run.name ?? null;
  const platforms = goalPlatforms(run);
  const strategist = isStrategistPlan(run);
  const email = !strategist && isEmailPlan(run);
  const summarize = !strategist && !email && isSummarizePlan(run);
  const secured = hasSecurityScan(run);
  const { weeks, estPosts } = strategist ? campaignShape(run) : { weeks: null, estPosts: null };
  const scopeText = estPosts ? t('runcard.strategist.scope_count', { n: estPosts }) : t('runcard.strategist.scope_multi');
  const weeksText = weeks ? (weeks > 1 ? t('runcard.strategist.weeks_other', { weeks }) : t('runcard.strategist.weeks_one', { weeks })) : '';

  return (
    <div className="dag-block run-card">
      {strategist ? (
        <div className="plan-scope strategist">
          <strong>{t('runcard.strategist.title')}</strong>
          <span className="muted small">
            {t('runcard.strategist.desc', { scope: scopeText, weeksPhrase: weeksText })}
          </span>
        </div>
      ) : email ? (
        <div className="plan-scope email">
          <strong>{t('runcard.email.title')}</strong>
          <span className="muted small">{t('runcard.email.desc')}</span>
        </div>
      ) : summarize ? (
        <div className="plan-scope summarize">
          <strong>{t('runcard.summarize.title')}</strong>
          <span className="muted small">
            {t('runcard.summarize.desc')}
            {secured && <> {t('runcard.summarize.masks_pre')}<b>{t('runcard.summarize.masks_word')}</b>{t('runcard.summarize.masks_post')}</>}
          </span>
        </div>
      ) : (
        <div className="plan-scope single">
          <strong>{t('runcard.single.title')}</strong>
          <span className="muted small">{t('runcard.single.desc')}</span>
        </div>
      )}
      <div className="eyebrow">{t('runcard.plan.eyebrow', { steps: run.nodes.length })}</div>
      {platforms.length > 0 && (
        <div className="plan-platforms">
          <span className="muted small">{t('runcard.publishes_to')}</span>
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
              {busy ? (strategist ? t('runcard.busy.scheduling') : t('runcard.busy.running')) : strategist ? t('runcard.cta.draft_calendar') : summarize ? t('runcard.cta.approve_run') : t('runcard.cta.approve_run_now')}
            </button>
            <span className="muted small">
              {strategist
                ? <>{t('runcard.hint.strategist_pre')}<b>{t('runcard.hint.strategist_bold')}</b>{t('runcard.hint.strategist_post')}</>
                : summarize
                ? <>{t('runcard.hint.summarize_pre')}{secured ? <> {t('runcard.hint.summarize_secured')}</> : ''}{t('runcard.hint.summarize_post')}</>
                : <>{t('runcard.hint.single_pre')}<b>{t('runcard.hint.single_bold')}</b>{t('runcard.hint.single_post')}</>}
            </span>
          </div>
          <p className="muted small plan-refine-hint">{t('runcard.refine_hint')}</p>
          <div className="save-flow-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName ? t('runcard.save.placeholder_named', { name: defaultName }) : t('runcard.save.placeholder_generic')}
              onKeyDown={(e) => { if (e.key === 'Enter' && (name.trim() || defaultName)) onSave((name.trim() || defaultName)); }}
            />
            <button className="btn" disabled={busy} onClick={() => onSave(name.trim() || defaultName || t('flow.untitled'))}>
              {busy ? t('runcard.save.busy') : t('runcard.save.cta')}
            </button>
          </div>
        </div>
      )}

      {savedName && (
        <p className="muted small saved-confirm">{t('runcard.saved_as', { name: savedName })}</p>
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
  const { t } = useLocale();
  return (
    <div className="save-offer">
      <button className="btn primary" disabled={busy} onClick={onSetupCampaign}>{t('runcard.offer.setup_campaign')}</button>
      <button className="btn" disabled={busy} onClick={onRunTest}>{t('runcard.offer.run_test')}</button>
      <button className="btn ghost" disabled={busy} onClick={onOpenFlow}>{t('runcard.offer.open_flow')}</button>
    </div>
  );
}
