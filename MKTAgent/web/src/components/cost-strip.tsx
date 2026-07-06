// Friendly credits + raw token/cost summary strip (Phase 03). One shared renderer for
// every place a run/flow/usage total is shown: the flow-template rollup dashboard, a
// single run's own spend, and the usage dashboard totals. Credits are the PRIMARY number
// (non-tech friendly, "≈ 60 credits"); raw tokens + USD stay as a secondary/hover detail
// so nothing is hidden, just de-emphasized. Falls back to a plain token count when an
// older/partial summary has no `credits` (e.g. stale cached data) — never breaks.
export interface CostStripValue {
  costUsd: number;
  totalTokens: number;
  credits?: number;
}

interface SecondaryMetric {
  value: number;
  label: string;
  pluralLabel?: string;
}

interface Props {
  cost: CostStripValue;
  // Optional second metric slot (post-run count for a flow, call count for usage totals).
  secondaryMetric?: SecondaryMetric;
}

export function CostStrip({ cost, secondaryMetric }: Props) {
  const hasCredits = typeof cost.credits === 'number';
  const detail = `$${cost.costUsd.toFixed(3)} · ${cost.totalTokens.toLocaleString()} tokens`;

  return (
    <div className="flow-cost-strip">
      <div className="flow-cost-metric">
        <span className="flow-cost-value flow-cost-credits" title={detail}>
          {hasCredits ? `≈ ${cost.credits} credits` : `${cost.totalTokens.toLocaleString()} tokens`}
        </span>
        <span className="flow-cost-label">{hasCredits ? detail : 'spend'}</span>
      </div>
      {secondaryMetric && (
        <div className="flow-cost-metric">
          <span className="flow-cost-value">{secondaryMetric.value}</span>
          <span className="flow-cost-label">
            {secondaryMetric.value === 1 ? secondaryMetric.label : (secondaryMetric.pluralLabel ?? `${secondaryMetric.label}s`)}
          </span>
        </div>
      )}
    </div>
  );
}
