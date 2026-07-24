// Global top navigation (Command Center Unification P1). Replaces the left sidebar: all destinations
// live here. Brand → Command Center; a row of page items (the convertto.png move: Instructions/Impact/
// Connections/Usage/Scheduled + Product Knowledge/Leads); Workspace ▾ (reused menu) and Chats ▾
// (history: search/select/delete); credits, theme, user. Dark-first to match the Command Center skin.
import { useEffect, useRef, useState } from 'react';
import type { Page } from '../app-nav';
import type { WorkspaceSummaryDto, AgentChatSessionDto } from '../api/client';
import { WorkspaceMenu } from './workspace-menu';
import { LanguageSwitcher } from './language-switcher';
import { useLocale } from '../i18n';

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  credits: number | null;
  userEmail: string;
  onLogout: () => void;
  workspaces: WorkspaceSummaryDto[];
  onOpenWorkspace: (campaignId: string) => void;
  onContinueChat: (chatSessionId: string) => void;
  onDeleteWorkspace: (campaignId: string, name: string) => void;
  chats: AgentChatSessionDto[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onError?: (msg: string) => void;
}

const NAV: Array<{ page: Page; label: string; icon: string }> = [
  { page: 'command-center', label: 'Command Center', icon: '◈' },
  { page: 'impact', label: 'Impact', icon: '📈' },
  { page: 'instructions', label: 'Instructions', icon: '⚙' },
  { page: 'connections', label: 'Connections', icon: '🔌' },
  { page: 'usage', label: 'Usage', icon: '📊' },
  { page: 'scheduled', label: 'Scheduled', icon: '◷' },
  { page: 'product-knowledge', label: 'Knowledge', icon: '📚' },
  { page: 'leads', label: 'Leads', icon: '🎯' },
];

export function TopNav(props: Props) {
  const { page, onNavigate, credits, userEmail, chats, activeChatId, onSelectChat, onDeleteChat } = props;
  const { t } = useLocale();
  const [chatsOpen, setChatsOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chatsOpen) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setChatsOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [chatsOpen]);

  const filtered = q.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()))
    : chats;

  return (
    <header className="app-topnav">
      <button className="topnav-brand" onClick={() => onNavigate('command-center')} title="Command Center">
        <span className="topnav-logo" />
        <span className="topnav-brand-name">Atria</span>
        <span className="topnav-brand-tag">COMMAND CENTER</span>
      </button>

      <nav className="topnav-items">
        {NAV.map((n) => (
          <button
            key={n.page}
            className={`topnav-item ${page === n.page ? 'is-active' : ''}`}
            onClick={() => onNavigate(n.page)}
            title={n.label}
          >
            <span className="topnav-item-icon">{n.icon}</span>
            <span className="topnav-item-label">{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="topnav-right">
        <div className="topnav-chats" ref={ref}>
          <button className="topnav-item" onClick={() => setChatsOpen((v) => !v)} aria-haspopup="menu" aria-expanded={chatsOpen}>
            💬 {t('nav.chats.label')} <span className="topnav-caret">▾</span>
          </button>
          {chatsOpen && (
            <div className="topnav-chats-panel" role="menu">
              <input className="topnav-chats-search" placeholder={t('nav.chats.search')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="topnav-chats-list">
                {filtered.length === 0 && <div className="topnav-chats-empty">{t('nav.chats.empty')}</div>}
                {filtered.map((c) => (
                  <div key={c.id} className={`topnav-chats-row ${activeChatId === c.id ? 'is-active' : ''}`}>
                    <button className="topnav-chats-name" onClick={() => { onSelectChat(c.id); setChatsOpen(false); }}>{c.title}</button>
                    <button className="topnav-chats-del" aria-label={t('nav.chat.delete', { title: c.title })} onClick={() => onDeleteChat(c.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <WorkspaceMenu
          workspaces={props.workspaces}
          activeCampaignId={null}
          onOpenWorkspace={props.onOpenWorkspace}
          onContinueChat={props.onContinueChat}
          onDelete={props.onDeleteWorkspace}
          onExit={() => onNavigate('command-center')}
        />

        <LanguageSwitcher onError={props.onError} />

        <span className="topnav-credit" title={t('nav.credits.title')}>◈ {credits === null ? '—' : credits.toLocaleString()}</span>
        <span className="topnav-user" title={userEmail}>{userEmail}</span>
        <button className="topnav-item" onClick={props.onLogout} title={t('nav.signout')}>⎋ <span className="topnav-item-label">{t('nav.signout')}</span></button>
      </div>
    </header>
  );
}
