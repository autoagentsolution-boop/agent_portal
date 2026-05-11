import { safeArray, safeNumber, unwrapData, type Extractor } from '../types.js';

interface Classification {
  lead_type?: string;
  score?: number;
}

export const extract: Extractor = (output) => {
  const o = unwrapData(output);
  const items = safeNumber(o.items_processed);
  const classifications = safeArray<Classification>(o.classifications);

  let hot = 0;
  let warm = 0;
  let cold = 0;
  for (const c of classifications) {
    const t = (c?.lead_type ?? '').toString().toLowerCase().replace(/_lead$/, '');
    if (t === 'hot') hot++;
    else if (t === 'warm') warm++;
    else if (t === 'cold') cold++;
  }

  return {
    items,
    metrics: {
      leads_classified: items,
      hot_leads: hot,
      warm_leads: warm,
      cold_leads: cold,
    },
  };
};

export const format = {
  headlineKey: 'hot_leads',
  labels: {
    leads_classified: 'Leads classified',
    hot_leads: 'Hot leads',
    warm_leads: 'Warm leads',
    cold_leads: 'Cold leads',
    hot_lead_rate: 'Hot lead rate',
  },
  suffixes: { hot_lead_rate: '%' },
  manualMinutesPerItem: 2,
  basis: '2 min saved per lead classified manually',
};

export function postAggregate(metrics: Record<string, number>): Record<string, number> {
  const total = metrics.leads_classified ?? 0;
  const hot = metrics.hot_leads ?? 0;
  const rate = total > 0 ? Number(((hot / total) * 100).toFixed(2)) : 0;
  return { ...metrics, hot_lead_rate: rate };
}
