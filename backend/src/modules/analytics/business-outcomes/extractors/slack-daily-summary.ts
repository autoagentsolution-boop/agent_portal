import { safeArray, safeNumber, unwrapData, type Extractor } from '../types.js';

export const extract: Extractor = (output) => {
  const o = unwrapData(output);
  const items = safeNumber(o.items_processed);
  const risks = safeArray(o.risks);
  const actions = safeArray(o.action_items);

  return {
    items,
    metrics: {
      messages_summarized: items,
      risks_flagged: risks.length,
      action_items_created: actions.length,
    },
  };
};

export const format = {
  headlineKey: 'risks_flagged',
  labels: {
    messages_summarized: 'Messages summarized',
    risks_flagged: 'Risks flagged',
    action_items_created: 'Action items created',
  },
  manualMinutesPerItem: 0.5,
  basis: '30s saved per message reviewed manually',
};

export function postAggregate(metrics: Record<string, number>): Record<string, number> {
  return metrics;
}
