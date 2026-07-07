// Proactive suggestion cards (Atria Phase 08 / surfaces Phase 06). The "smart assistant" WOW: Atria
// reads your history and offers the next move — plan a month, repeat a winner, or a roadmap pitch —
// each with the shown rationale (the trust story). Accepting a campaign suggestion prefills the flow;
// accepting a roadmap pitch logs demand. Nothing runs without your later review + grant.
import { useEffect, useState } from 'react';
import { api, type AtriaSuggestion } from '../api/client';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  // Accepting a campaign-plan suggestion hands the prefilled intent to the Orchestrate flow.
  onPlanCampaign?: (intent: string) => void;
}

const ICON: Record<AtriaSuggestion['kind'], string> = {
  plan_campaign: '🗓️', repeat_winner: '🔁', roadmap_email: '📧', roadmap_memory: '🧠',
};

export function AtriaSuggestionCards({ notify, onPlanCampaign }: Props) {
  const [items, setItems] = useState<AtriaSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.atriaSuggestions().then((r) => { if (r.ok) setItems(r.data); setLoaded(true); });
  }, []);

  const accept = async (s: AtriaSuggestion) => {
    if (s.prefill.roadmapAgentId) {
      const r = await api.acceptRoadmap(s.prefill.roadmapAgentId);
      if (r.ok) notify('Noted — we\'ll prioritize building this for you.');
      else notify(r.error.error, 'err');
    } else if (s.prefill.intent) {
      onPlanCampaign?.(s.prefill.intent);
      notify('Opening a campaign plan from your intent — review before it runs.');
    }
    setDismissed((d) => new Set(d).add(s.kind));
  };

  const visible = items.filter((s) => !dismissed.has(s.kind));
  if (!loaded || visible.length === 0) return null;

  return (
    <section style={{ display: 'grid', gap: 12, margin: '8px 0 20px' }}>
      {visible.map((s) => (
        <article key={s.kind} style={{ padding: 14, border: '1px solid var(--border, #ddd)', borderRadius: 10, background: 'var(--card, #fafafa)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{ICON[s.kind]}</span>
            <strong style={{ flex: 1 }}>{s.headline}</strong>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed((d) => new Set(d).add(s.kind))}>×</button>
          </div>
          <p className="muted" style={{ margin: '8px 0 12px' }}>{s.rationale}</p>
          <button className="btn-primary" onClick={() => void accept(s)}>
            {s.prefill.roadmapAgentId ? 'I want this' : 'Plan it'}
          </button>
        </article>
      ))}
    </section>
  );
}
