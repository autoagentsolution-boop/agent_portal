// Command Center top-right Workspace switcher (Atria v2 — replaces the landing chip strip that
// duplicated the chat history). "⌂ Workspace ▾" opens a menu of the owner's workspaces; each row
// opens the workspace drawer, offers "continue chat" (reopen the master-agent conversation that
// spawned it — disabled when no chat is linked), and delete (destructive, confirmed). An "Exit to
// classic view" item preserves the old ⌂ Workspace button's job.
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceSummaryDto, DerivedPostStatus } from '../api/client';
import { useLocale } from '../i18n';

const STATUS_COLOR: Record<DerivedPostStatus, string> = {
  planned: 'var(--muted)', running: 'var(--blue)', held: 'var(--amber)', posted: 'var(--green)', failed: 'var(--red)',
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
  const { t } = useLocale();
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

  // Disambiguating subtitle — many workspaces share the same product name, so the name alone is
  // useless. Show post count + platforms + last-activity date so each row is distinguishable.
  const subtitle = (w: WorkspaceSummaryDto): string => {
    const d = new Date(w.updatedAt);
    const date = `${d.getMonth() + 1}/${d.getDate()}`;
    const plats = w.platforms.length ? w.platforms.slice(0, 3).join(', ') : t('ws.menu.no_platforms');
    return t('ws.menu.subtitle', { posts: w.postCount, platforms: plats, date });
  };

  return (
    <div className="cc-ws-menu" ref={ref}>
      <button className={`cc-exit cc-ws-menu-btn ${workspaces.length ? 'has-ws' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title={t('ws.menu.dashboard_title')}>
        ⌂ {t('ws.menu.label')}
        {workspaces.length > 0 && <span className="cc-ws-menu-count">{workspaces.length}</span>}
        <span className="cc-ws-menu-caret">▾</span>
      </button>
      {open && (
        <div className="cc-ws-menu-panel" role="menu">
          <div className="cc-ws-menu-head">{t('ws.menu.head', { count: workspaces.length })}</div>
          <div className="cc-ws-menu-list">
            {workspaces.length === 0 && <div className="cc-ws-menu-empty">{t('ws.menu.empty')}</div>}
            {workspaces.map((w) => (
              <div key={w.campaignId} className={`cc-ws-menu-row ${activeCampaignId === w.campaignId ? 'is-active' : ''}`}>
                <button
                  className="cc-ws-menu-name"
                  title={t('ws.menu.name_title', { count: w.postCount, credits: Math.round(w.credits).toLocaleString() })}
                  onClick={() => { onOpenWorkspace(w.campaignId); setOpen(false); }}
                >
                  <span className="ws-dot" style={{ background: statusDot(w) }} />
                  <span className="cc-ws-menu-name-col">
                    <span className="cc-ws-menu-name-text">{w.name}</span>
                    <span className="cc-ws-menu-sub">{subtitle(w)}</span>
                  </span>
                </button>
                <button
                  className="cc-ws-menu-act"
                  disabled={!w.chatSessionId}
                  title={w.chatSessionId ? t('ws.menu.continue_chat') : t('ws.menu.no_chat')}
                  onClick={() => { if (w.chatSessionId) { onContinueChat(w.chatSessionId); setOpen(false); } }}
                >
                  💬
                </button>
                <button
                  className="cc-ws-menu-act cc-ws-menu-del"
                  title={t('ws.menu.delete')}
                  onClick={() => onDelete(w.campaignId, w.name)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="cc-ws-menu-exit" onClick={() => { setOpen(false); onExit(); }}>⤴ {t('ws.menu.exit')}</button>
        </div>
      )}
    </div>
  );
}
