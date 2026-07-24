// Proactive suggestion cards (Atria Phase 08 / surfaces Phase 06). The "smart assistant" WOW: Atria
// reads your history and offers the next move — plan a month, repeat a winner, or a roadmap pitch —
// each with the shown rationale (the trust story). Accepting a campaign suggestion prefills the flow;
// accepting a roadmap pitch logs demand. Nothing runs without your later review + grant.
import { useEffect, useState } from 'react';
import { api, type AtriaSuggestion } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  // Accepting a campaign-plan suggestion hands the prefilled intent to the Orchestrate flow.
  onPlanCampaign?: (intent: string) => void;
  // Suggestions already acted on THIS session — kept by the parent so they don't reappear when this
  // card list remounts (e.g. after leaving/returning to the chat), which let the user re-fire the same
  // "Plan it" over and over → a fresh LLM plan each time. onAct records a newly-acted suggestion.
  acted?: ReadonlySet<string>;
  onAct?: (kind: string) => void;
}

const ICON: Record<AtriaSuggestion['kind'], string> = {
  plan_campaign: '🗓️', repeat_winner: '🔁', roadmap_email: '📧', roadmap_memory: '🧠',
};

export function AtriaSuggestionCards({ notify, onPlanCampaign, acted, onAct }: Props) {
  const { t } = useLocale();
  const [items, setItems] = useState<AtriaSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.atriaSuggestions().then((r) => { if (r.ok) setItems(r.data); setLoaded(true); });
  }, []);

  const accept = async (s: AtriaSuggestion) => {
    if (s.prefill.roadmapAgentId) {
      const r = await api.acceptRoadmap(s.prefill.roadmapAgentId);
      if (r.ok) notify(t('suggestions.roadmap_noted'));
      else notify(tError(r.error), 'err');
    } else if (s.prefill.intent) {
      onPlanCampaign?.(s.prefill.intent);
      notify(t('suggestions.plan_asked'));
    }
    setDismissed((d) => new Set(d).add(s.kind));
    onAct?.(s.kind); // persist at the parent so this suggestion won't reappear + get re-fired
  };

  const visible = items.filter((s) => !dismissed.has(s.kind) && !(acted?.has(s.kind)));
  if (!loaded) return null;
  if (visible.length === 0) {
    return <p className="muted small">{t('suggestions.empty')}</p>;
  }

  return (
    <section className="atria-card-grid">
      {visible.map((s) => (
        <article key={s.kind} className="atria-suggestion">
          <div className="atria-suggestion-head">
            <span className="atria-card-icon">{ICON[s.kind]}</span>
            <strong>{s.headline}</strong>
            <button className="icon-btn" aria-label={t('suggestions.dismiss')} onClick={() => setDismissed((d) => new Set(d).add(s.kind))}>×</button>
          </div>
          <p className="muted">{s.rationale}</p>
          <button className="btn-primary" onClick={() => void accept(s)}>
            {s.prefill.roadmapAgentId ? t('suggestions.roadmap_cta') : t('suggestions.plan_cta')}
          </button>
        </article>
      ))}
    </section>
  );
}
