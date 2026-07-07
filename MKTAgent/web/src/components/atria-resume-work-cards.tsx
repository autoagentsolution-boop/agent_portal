// "Continue where you left off" cards for the Atria hub — recent chats (the DTO carries no
// flow/campaign linkage, so they're labeled "Recent chat", not "unfinished") and saved flows
// with no campaign yet.
// Pure presentation: resuming routes through the SAME handlers the sidebar uses (selectChat /
// openSavedFlow), so this is an entry point, not a second implementation.
interface ChatItem { id: string; title: string; updatedAt: string }
interface FlowItem { id: string; name: string }

interface Props {
  chats: ChatItem[];
  flows: FlowItem[];
  onResumeChat: (id: string) => void;
  onOpenFlow: (id: string) => void;
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function AtriaResumeWorkCards({ chats, flows, onResumeChat, onOpenFlow }: Props) {
  if (chats.length === 0 && flows.length === 0) return null;
  return (
    <section>
      <h3 className="atria-section-title">Continue where you left off</h3>
      <div className="atria-card-grid">
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
