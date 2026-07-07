// Atria hub — the strategist's HOME, not a settings page. Default view answers "what should
// I do next?": ask Atria directly (auto-sends into the Orchestrate chat), act on proactive
// reminders, or resume unfinished chats/flows. Workspace instructions and the impact report
// still live here but behind their own tabs, so the landing never reads as setup/dashboard.
import { useState } from 'react';
import { AtriaSuggestionCards } from './atria-suggestion-cards';
import { AtriaResumeWorkCards } from './atria-resume-work-cards';
import { InstructionEditor } from './instruction-editor';
import { ImpactReport } from './impact-report';
import { CampaignCommandView } from './campaign-command-view';

interface Props {
  activeCampaign: string | null;
  chats: Array<{ id: string; title: string; updatedAt: string }>;
  flowsWithoutStrategy: Array<{ id: string; name: string }>;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  // Hands the intent to the Orchestrate chat, which auto-sends it (plan appears immediately).
  onPlanCampaign: (intent: string) => void;
  onResumeChat: (id: string) => void;
  onOpenFlow: (id: string) => void;
}

type Tab = 'home' | 'instructions' | 'impact';

const askStarters = [
  'Plan a month of content for my product',
  'Plan a 2-week spotlight campaign for a launch',
];

export function AtriaHubPage({ activeCampaign, chats, flowsWithoutStrategy, notify, onPlanCampaign, onResumeChat, onOpenFlow }: Props) {
  const [tab, setTab] = useState<Tab>('home');
  const [ask, setAsk] = useState('');

  const submit = () => {
    const text = ask.trim();
    if (text.length < 3) { notify('Tell Atria what to plan first', 'err'); return; }
    onPlanCampaign(text);
  };

  return (
    <div className="master-home atria-hub">
      <div className="atria-hub-inner">
        <header className="atria-hub-head">
          <div>
            <h2>✦ Atria</h2>
            <p className="muted">Your proactive marketing strategist — ask for a campaign plan, or pick up unfinished work.</p>
          </div>
          <nav className="atria-tabs" aria-label="Atria sections">
            <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>Home</button>
            <button className={tab === 'instructions' ? 'active' : ''} onClick={() => setTab('instructions')}>Instructions</button>
            <button className={tab === 'impact' ? 'active' : ''} onClick={() => setTab('impact')}>Impact</button>
          </nav>
        </header>

        {tab === 'home' && (
          <div className="atria-home-stack">
            <div className="composer-box atria-ask">
              <span className="composer-plus" aria-hidden="true">✦</span>
              <textarea
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder="Ask Atria — e.g. “Plan a month of content for our AI course”…"
                rows={1}
              />
              <button className="composer-send" aria-label="Send to Atria" onClick={submit}>↑</button>
            </div>
            <div className="prompt-chip-row">
              {askStarters.map((chip) => (
                <button className="prompt-chip" key={chip} onClick={() => setAsk(chip)}>{chip}</button>
              ))}
            </div>

            <section>
              <h3 className="atria-section-title">Reminders from Atria</h3>
              <AtriaSuggestionCards notify={notify} onPlanCampaign={onPlanCampaign} />
            </section>

            <AtriaResumeWorkCards
              chats={chats.slice(0, 4)}
              flows={flowsWithoutStrategy.slice(0, 4)}
              onResumeChat={onResumeChat}
              onOpenFlow={onOpenFlow}
            />
          </div>
        )}

        {tab === 'instructions' && <InstructionEditor scope="workspace" notify={notify} />}

        {tab === 'impact' && (
          <div className="atria-home-stack">
            {activeCampaign && (
              <>
                <CampaignCommandView campaignId={activeCampaign} />
                <ImpactReport campaignId={activeCampaign} />
              </>
            )}
            <ImpactReport period="30d" />
          </div>
        )}
      </div>
    </div>
  );
}
