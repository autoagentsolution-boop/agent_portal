// "Continue where you left off" cards for the Atria hub — in-flight runs (paused/running, resumed via
// their chat), recent chats, and saved flows with no campaign yet. Each card carries a dismiss ✕ that
// deletes the underlying item (the user's own clutter) via onDismiss.
// Pure presentation: resuming routes through the SAME handlers the sidebar uses (selectChat /
// openSavedFlow), so this is an entry point, not a second implementation.
import { useLocale, t as mt, type MessageKey } from '../i18n';

interface ChatItem { id: string; title: string; updatedAt: string }
interface FlowItem { id: string; name: string }
interface RunItem { id: string; name: string | null; status: string; chatSessionId: string; updatedAt: string }

type DismissKind = 'run' | 'chat' | 'flow';

interface Props {
  chats: ChatItem[];
  flows: FlowItem[];
  runs?: RunItem[];
  onResumeChat: (id: string) => void;
  onOpenFlow: (id: string) => void;
  onDismiss?: (kind: DismissKind, id: string) => void;
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// A resumable run's human status — what's blocking it, so the card reads as unfinished work, not a chat.
const runStatusLabel = (status: string): string => {
  const key = ({
    needs_approval: 'resume.status.needs_approval',
    needs_connection: 'resume.status.needs_connection',
    running: 'resume.status.running',
    planned: 'resume.status.planned',
  } as Record<string, MessageKey>)[status] ?? 'resume.status.in_progress';
  return mt(key);
};

// One card = an .atria-card button (the resume/open action) + a sibling ✕ inside a positioned wrapper,
// so the dismiss control is never a <button> nested inside another <button> (invalid HTML).
function ResumeCard(
  { icon, title, sub, cta, onClick, onDismiss }:
  { icon: string; title: string; sub: string; cta: string; onClick: () => void; onDismiss?: () => void },
) {
  return (
    <div className="atria-card-wrap">
      <button className="atria-card" onClick={onClick}>
        <span className="atria-card-icon">{icon}</span>
        <span className="atria-card-body">
          <strong>{title}</strong>
          <span className="muted small">{sub}</span>
        </span>
        <span className="atria-card-cta">{cta}</span>
      </button>
      {onDismiss && (
        <button className="atria-card-dismiss icon-btn" aria-label={mt('resume.remove.aria')} title={mt('resume.remove.title')} onClick={onDismiss}>×</button>
      )}
    </div>
  );
}

export function AtriaResumeWorkCards({ chats, flows, runs = [], onResumeChat, onOpenFlow, onDismiss }: Props) {
  const { t } = useLocale();
  if (chats.length === 0 && flows.length === 0 && runs.length === 0) return null;
  return (
    <section>
      <h3 className="atria-section-title">{t('resume.section.title')}</h3>
      <div className="atria-card-grid">
        {runs.map((r) => (
          <ResumeCard
            key={r.id}
            icon="⚡"
            title={r.name?.trim() || t('flow.untitled')}
            sub={`${runStatusLabel(r.status)} · ${dayLabel(r.updatedAt)}`}
            cta={t('resume.cta.resume')}
            onClick={() => onResumeChat(r.chatSessionId)}
            onDismiss={onDismiss && (() => onDismiss('run', r.id))}
          />
        ))}
        {chats.map((c) => (
          <ResumeCard
            key={c.id}
            icon="💬"
            title={c.title}
            sub={t('resume.sub.recent_chat', { day: dayLabel(c.updatedAt) })}
            cta={t('resume.cta.resume')}
            onClick={() => onResumeChat(c.id)}
            onDismiss={onDismiss && (() => onDismiss('chat', c.id))}
          />
        ))}
        {flows.map((f) => (
          <ResumeCard
            key={f.id}
            icon="⚡"
            title={f.name}
            sub={t('resume.sub.saved_flow')}
            cta={t('resume.cta.open')}
            onClick={() => onOpenFlow(f.id)}
            onDismiss={onDismiss && (() => onDismiss('flow', f.id))}
          />
        ))}
      </div>
    </section>
  );
}
