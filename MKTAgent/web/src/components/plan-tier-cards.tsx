// Plan-tier cards (Phase 03 checkpoint 2) — shown on a `planned` run BEFORE execute, when
// the goal was tiered into Economy/Balanced/Full variants. Picking a card applies that
// tier's DAG (POST apply-tier) then hands off into the caller's existing execute flow, so
// this component owns selection only, not execution. Renders nothing when there are no
// tiers — the caller keeps its current single-plan "Execute flow" button (no regression).
import type { PlanTier, PlanTierId } from '../api/client';

interface Props {
  tiers: PlanTier[];
  busyTierId: PlanTierId | null;
  onSelect: (tierId: PlanTierId) => void;
}

export function PlanTierCards({ tiers, busyTierId, onSelect }: Props) {
  if (tiers.length === 0) return null;
  const disabled = busyTierId !== null;

  return (
    <div className="tier-cards">
      <p className="muted small tier-cards-hint">Choose how much this flow should run — credits scale with agent count.</p>
      <div className="tier-cards-row">
        {tiers.map((t) => (
          <button
            key={t.id}
            className={`tier-card tier-${t.id}`}
            disabled={disabled}
            onClick={() => onSelect(t.id)}
          >
            <div className="tier-card-head">
              <span className="tier-label">{t.label}</span>
              <span className="tier-agent-count">{t.estimate.agentCount} agent{t.estimate.agentCount === 1 ? '' : 's'}</span>
            </div>
            <p className="tier-desc muted small">{t.description}</p>
            <div className="tier-credits" title={`${t.estimate.totalTokens.toLocaleString()} tokens · $${t.estimate.costUsd.toFixed(3)}`}>
              ≈ {t.estimate.credits} credits
            </div>
            <div className="tier-tokens muted small">≈ {t.estimate.totalTokens.toLocaleString()} tokens</div>
            {busyTierId === t.id && <div className="muted small tier-busy">Starting…</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
