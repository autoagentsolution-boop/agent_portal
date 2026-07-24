// Plan-tier cards (Phase 03 checkpoint 2) — shown on a `planned` run BEFORE execute, when
// the goal was tiered into Economy/Balanced/Full variants. Picking a card applies that
// tier's DAG (POST apply-tier) then hands off into the caller's existing execute flow, so
// this component owns selection only, not execution. Renders nothing when there are no
// tiers — the caller keeps its current single-plan "Execute flow" button (no regression).
import type { PlanTier, PlanTierId } from '../api/client';
import { useLocale } from '../i18n';

interface Props {
  tiers: PlanTier[];
  busyTierId: PlanTierId | null;
  onSelect: (tierId: PlanTierId) => void;
}

export function PlanTierCards({ tiers, busyTierId, onSelect }: Props) {
  const { t } = useLocale();
  if (tiers.length === 0) return null;
  const disabled = busyTierId !== null;

  return (
    <div className="tier-cards">
      <p className="muted small tier-cards-hint">{t('plan.tier.hint')}</p>
      <div className="tier-cards-row">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            className={`tier-card tier-${tier.id}`}
            disabled={disabled}
            onClick={() => onSelect(tier.id)}
          >
            <div className="tier-card-head">
              <span className="tier-label">{tier.label}</span>
              <span className="tier-agent-count">
                {t(tier.estimate.agentCount === 1 ? 'plan.tier.agent_count.one' : 'plan.tier.agent_count.other', { count: tier.estimate.agentCount })}
              </span>
            </div>
            <p className="tier-desc muted small">{tier.description}</p>
            <div className="tier-credits" title={`${tier.estimate.totalTokens.toLocaleString()} tokens · $${tier.estimate.costUsd.toFixed(3)}`}>
              {t('plan.tier.credits', { credits: tier.estimate.credits })}
            </div>
            <div className="tier-tokens muted small">{t('plan.tier.tokens', { tokens: tier.estimate.totalTokens.toLocaleString() })}</div>
            {busyTierId === tier.id && <div className="muted small tier-busy">{t('workflow.execute.starting')}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
