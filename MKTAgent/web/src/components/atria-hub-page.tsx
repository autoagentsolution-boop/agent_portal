// Atria hub (Phase 08) — one place that surfaces the campaign-intelligence story: proactive
// suggestions, the workspace instruction editor, the period impact report, and (when a campaign is
// selected) its live command board + impact. Thin composition of the Phase-08 components.
import { AtriaSuggestionCards } from './atria-suggestion-cards';
import { InstructionEditor } from './instruction-editor';
import { ImpactReport } from './impact-report';
import { CampaignCommandView } from './campaign-command-view';

interface Props {
  activeCampaign: string | null;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onPlanCampaign: (intent: string) => void;
}

export function AtriaHubPage({ activeCampaign, notify, onPlanCampaign }: Props) {
  return (
    <div className="master-home" style={{ display: 'grid', gap: 28, padding: '8px 4px' }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>Atria</h2>
        <p className="muted" style={{ marginTop: 0 }}>Your proactive marketing strategist.</p>
      </div>

      <AtriaSuggestionCards notify={notify} onPlanCampaign={onPlanCampaign} />

      {activeCampaign && (
        <>
          <CampaignCommandView campaignId={activeCampaign} />
          <ImpactReport campaignId={activeCampaign} />
        </>
      )}

      <InstructionEditor scope="workspace" notify={notify} />

      <ImpactReport period="30d" />
    </div>
  );
}
