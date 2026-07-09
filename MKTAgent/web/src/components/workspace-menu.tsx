// Command Center top-right Workspace switcher (Atria v2 — replaces the landing chip strip that
// duplicated the chat history). "⌂ Workspace ▾" opens a menu of the owner's workspaces; each row
// opens the workspace drawer, offers "continue chat" (reopen the master-agent conversation that
// spawned it — disabled when no chat is linked), and delete (destructive, confirmed). An "Exit to
// classic view" item preserves the old ⌂ Workspace button's job.
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceSummaryDto, DerivedPostStatus } from '../api/client';

const STATUS_COLOR: Record<DerivedPostStatus, string> = {
  planned: '#9aa0a6', running: '#1a73e8', held: '#f9ab00', posted: '#188038', failed: '#d93025',
};

interface Props {
  workspaces: WorkspaceSummaryDto[];
  activeCampaignId: string | null;
  onOpenWorkspace: (campaignId: string) => void;
  onContinueChat: (chatSessionId: string) => void;
  onDelete: (campaignId: string, name: string) => void;
  onExit: () => void;
}

export function WorkspaceMenu({ workspaces, activeCampaignId, onOpenWorkspace, onContinueChat, onDelete, onExit }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const statusDot = (w: WorkspaceSummaryDto): string => {
    const first = (['running', 'held', 'failed', 'posted', 'planned'] as DerivedPostStatus[]).find((k) => w.counts[k] > 0);
    return STATUS_COLOR[first ?? 'planned'];
  };

  return (
    <div className="cc-ws-menu" ref={ref}>
      <button className="cc-exit" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        ⌂ Workspace <span className="cc-ws-menu-caret">▾</span>
      </button>
      {open && (
        <div className="cc-ws-menu-panel" role="menu">
          <div className="cc-ws-menu-head">Workspaces · {workspaces.length}</div>
          <div className="cc-ws-menu-list">
            {workspaces.length === 0 && <div className="cc-ws-menu-empty">Chưa có workspace nào</div>}
            {workspaces.map((w) => (
              <div key={w.campaignId} className={`cc-ws-menu-row ${activeCampaignId === w.campaignId ? 'is-active' : ''}`}>
                <button
                  className="cc-ws-menu-name"
                  title={`${w.postCount} post(s) · ◈ ${Math.round(w.credits).toLocaleString()} cr`}
                  onClick={() => { onOpenWorkspace(w.campaignId); setOpen(false); }}
                >
                  <span className="ws-dot" style={{ background: statusDot(w) }} />
                  <span className="cc-ws-menu-name-text">{w.name}</span>
                </button>
                <button
                  className="cc-ws-menu-act"
                  disabled={!w.chatSessionId}
                  title={w.chatSessionId ? 'Tiếp tục trò chuyện với Atria' : 'Chưa có hội thoại liên kết'}
                  onClick={() => { if (w.chatSessionId) { onContinueChat(w.chatSessionId); setOpen(false); } }}
                >
                  💬
                </button>
                <button
                  className="cc-ws-menu-act cc-ws-menu-del"
                  title="Xoá workspace"
                  onClick={() => onDelete(w.campaignId, w.name)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="cc-ws-menu-exit" onClick={() => { setOpen(false); onExit(); }}>⤴ Về giao diện cổ điển</button>
        </div>
      )}
    </div>
  );
}
