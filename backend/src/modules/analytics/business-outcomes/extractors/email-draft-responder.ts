import { asRecord, safeArray, safeNumber, type Extractor } from '../types.js';

interface Draft {
  approval_status?: string;
  word_count?: number;
  body?: string;
}

export const extract: Extractor = (output) => {
  const o = asRecord(output);
  const items = safeNumber(o.items_processed);
  const drafts = safeArray<Draft>(o.drafts);

  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let wordTotal = 0;
  let wordCounted = 0;
  for (const d of drafts) {
    const status = (d?.approval_status ?? 'pending').toString().toLowerCase();
    if (status === 'approved') approved++;
    else if (status === 'rejected') rejected++;
    else pending++;

    const wc = safeNumber(d?.word_count);
    if (wc > 0) {
      wordTotal += wc;
      wordCounted++;
    } else if (typeof d?.body === 'string' && d.body.trim().length > 0) {
      const wcEstimated = d.body.trim().split(/\s+/).length;
      wordTotal += wcEstimated;
      wordCounted++;
    }
  }

  return {
    items: drafts.length || items,
    metrics: {
      drafts_created: drafts.length || items,
      drafts_approved: approved,
      drafts_pending: pending,
      drafts_rejected: rejected,
      _word_total: wordTotal,
      _word_counted: wordCounted,
    },
  };
};

export const format = {
  headlineKey: 'drafts_approved',
  labels: {
    drafts_created: 'Drafts created',
    drafts_approved: 'Approved',
    drafts_pending: 'Pending review',
    drafts_rejected: 'Rejected',
    avg_word_count: 'Avg word count',
  },
  manualMinutesPerItem: 6,
  basis: '6 min saved per approved draft (vs writing from scratch)',
};

export function postAggregate(metrics: Record<string, number>): Record<string, number> {
  const wordTotal = metrics._word_total ?? 0;
  const wordCounted = metrics._word_counted ?? 0;
  const avg = wordCounted > 0 ? Math.round(wordTotal / wordCounted) : 0;
  const { _word_total, _word_counted, ...rest } = metrics;
  return { ...rest, avg_word_count: avg };
}
