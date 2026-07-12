// "Continue where you left off" cards for the Atria hub — recent chats (the DTO carries no
// flow/campaign linkage, so they're labeled "Recent chat", not "unfinished") and saved flows
// with no campaign yet.
// Pure presentation: resuming routes through the SAME handlers the sidebar uses (selectChat /
// openSavedFlow), so this is an entry point, not a second implementation.
interface ChatItem { id: string; title: string; updatedAt: string }
interface FlowItem { id: string; name: string }
interface RunItem { id: string; name: string | null; status: string; chatSessionId: string; updatedAt: string }

interface Props {
  chats: ChatItem[];
  flows: FlowItem[];
  runs?: RunItem[];
  onResumeChat: (id: string) => void;
  onOpenFlow: (id: string) => void;
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// A resumable run's human status — what's blocking it, so the card reads as unfinished work, not a chat.
const runStatusLabel = (status: string): string => {
  switch (status) {
    case 'needs_approval': return 'Paused · waiting for your approval';
    case 'needs_connection': return 'Paused · needs a connection';
    case 'running': return 'Running…';
    case 'planned': return 'Ready to run';
    default: return 'In progress';
  }
};

export function AtriaResumeWorkCards({ chats, flows, runs = [], onResumeChat, onOpenFlow }: Props) {
  if (chats.length === 0 && flows.length === 0 && runs.length === 0) return null;
  return (
    <section>
      <h3 className="atria-section-title">Continue where you left off</h3>
      <div className="atria-card-grid">
        {runs.map((r) => (
          <button key={r.id} className="atria-card" onClick={() => onResumeChat(r.chatSessionId)}>
            <span className="atria-card-icon">⚡</span>
            <span className="atria-card-body">
              <strong>{r.name?.trim() || 'Untitled flow'}</strong>
              <span className="muted small">{runStatusLabel(r.status)} · {dayLabel(r.updatedAt)}</span>
            </span>
            <span className="atria-card-cta">Resume →</span>
          </button>
        ))}
        {chats.map((c) => (
          <button key={c.id} className="atria-card" onClick={() => onResumeChat(c.id)}>
            <span className="atria-card-icon">💬</span>
            <span className="atria-card-body">
              <strong>{c.title}</strong>
              <span className="muted small">Recent chat · {dayLabel(c.updatedAt)}</span>
            </span>
            <span className="atria-card-cta">Resume →</span>
          </button>
        ))}
        {flows.map((f) => (
          <button key={f.id} className="atria-card" onClick={() => onOpenFlow(f.id)}>
            <span className="atria-card-icon">⚡</span>
            <span className="atria-card-body">
              <strong>{f.name}</strong>
              <span className="muted small">Saved flow — no campaign started yet</span>
            </span>
            <span className="atria-card-cta">Open →</span>
          </button>
        ))}
      </div>
    </section>
  );
}
