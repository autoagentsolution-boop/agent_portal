import { asRecord, safeArray, safeNumber, type Extractor } from '../types.js';

interface Ticket {
  priority?: string;
  sentiment?: string;
}

export const extract: Extractor = (output) => {
  const o = asRecord(output);
  const items = safeNumber(o.items_processed);
  const tickets = safeArray<Ticket>(o.tickets);

  let critical = 0;
  let high = 0;
  let negative = 0;
  for (const t of tickets) {
    const p = (t?.priority ?? '').toString().toLowerCase();
    if (p === 'critical') critical++;
    else if (p === 'high') high++;

    const s = (t?.sentiment ?? '').toString().toLowerCase();
    if (s === 'frustrated' || s === 'negative') negative++;
  }

  return {
    items: tickets.length || items,
    metrics: {
      tickets_triaged: tickets.length || items,
      critical_tickets: critical,
      high_priority_tickets: high,
      sentiment_negative: negative,
    },
  };
};

export const format = {
  headlineKey: 'critical_tickets',
  labels: {
    tickets_triaged: 'Tickets triaged',
    critical_tickets: 'Critical',
    high_priority_tickets: 'High priority',
    sentiment_negative: 'Negative sentiment',
  },
  manualMinutesPerItem: 3,
  basis: '3 min saved per ticket triaged manually',
};

export function postAggregate(metrics: Record<string, number>): Record<string, number> {
  return metrics;
}
