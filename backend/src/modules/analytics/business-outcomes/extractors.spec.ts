import { unwrapData } from './types.js';
import * as gmailLead from './extractors/gmail-lead-classifier.js';
import * as emailDraft from './extractors/email-draft-responder.js';
import * as slackSummary from './extractors/slack-daily-summary.js';
import * as sheetChecker from './extractors/google-sheet-data-checker.js';
import * as ticketTriage from './extractors/ticket-triage-agent.js';

describe('unwrapData', () => {
  it('returns inner record when payload.data is a non-array object', () => {
    expect(unwrapData({ data: { x: 1 }, summary: 's' })).toEqual({ x: 1 });
  });

  it('returns raw record when payload has no data wrapper', () => {
    expect(unwrapData({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('returns raw record when payload.data is an array (not a record)', () => {
    expect(unwrapData({ data: [1, 2, 3], a: 9 })).toEqual({ data: [1, 2, 3], a: 9 });
  });

  it('returns empty record for null / non-object input', () => {
    expect(unwrapData(null)).toEqual({});
    expect(unwrapData(undefined)).toEqual({});
    expect(unwrapData('string')).toEqual({});
  });
});

describe('gmail-lead-classifier extractor', () => {
  const wrappedSample = {
    data: {
      summary: '3 leads classified.',
      classifications: [
        { lead_type: 'hot_lead', score: 110 },
        { lead_type: 'warm_lead', score: 70 },
        { lead_type: 'not_relevant', score: 0 },
      ],
      items_processed: 3,
    },
    summary: '3 leads classified.',
  };

  it('unwraps .data wrapper and strips _lead suffix when matching', () => {
    const r = gmailLead.extract(wrappedSample);
    expect(r.items).toBe(3);
    expect(r.metrics).toEqual({
      leads_classified: 3,
      hot_leads: 1,
      warm_leads: 1,
      cold_leads: 0,
    });
  });

  it('accepts flat (unwrapped) payload too', () => {
    const r = gmailLead.extract({
      classifications: [{ lead_type: 'hot' }, { lead_type: 'cold' }],
      items_processed: 2,
    });
    expect(r.metrics).toEqual({
      leads_classified: 2,
      hot_leads: 1,
      warm_leads: 0,
      cold_leads: 1,
    });
  });

  it('postAggregate computes hot_lead_rate', () => {
    const agg = gmailLead.postAggregate({ leads_classified: 4, hot_leads: 1 });
    expect(agg.hot_lead_rate).toBe(25);
  });

  it('postAggregate returns 0 rate when no leads', () => {
    expect(gmailLead.postAggregate({ leads_classified: 0, hot_leads: 0 }).hot_lead_rate).toBe(0);
  });

  it('ignores unknown lead_type values like not_relevant', () => {
    const r = gmailLead.extract({
      data: { classifications: [{ lead_type: 'not_relevant' }], items_processed: 1 },
    });
    expect(r.metrics).toEqual({
      leads_classified: 1,
      hot_leads: 0,
      warm_leads: 0,
      cold_leads: 0,
    });
  });
});

describe('email-draft-responder extractor', () => {
  const wrappedSample = {
    data: {
      drafts: [
        { approval_status: 'approved', body: 'hello world test draft' },
        { approval_status: 'pending', body: 'another draft text here' },
        { approval_status: 'rejected', word_count: 12 },
      ],
      items_processed: 3,
    },
    summary: '3 drafts',
  };

  it('unwraps .data and bucketizes by approval_status', () => {
    const r = emailDraft.extract(wrappedSample);
    expect(r.items).toBe(3);
    expect(r.metrics.drafts_created).toBe(3);
    expect(r.metrics.drafts_approved).toBe(1);
    expect(r.metrics.drafts_pending).toBe(1);
    expect(r.metrics.drafts_rejected).toBe(1);
  });

  it('postAggregate strips word totals and emits avg_word_count', () => {
    const r = emailDraft.extract(wrappedSample);
    const agg = emailDraft.postAggregate(r.metrics);
    expect(agg).not.toHaveProperty('_word_total');
    expect(agg).not.toHaveProperty('_word_counted');
    expect(agg.avg_word_count).toBeGreaterThan(0);
  });

  it('defaults missing approval_status to pending', () => {
    const r = emailDraft.extract({ data: { drafts: [{ body: 'a draft' }], items_processed: 1 } });
    expect(r.metrics.drafts_pending).toBe(1);
    expect(r.metrics.drafts_approved).toBe(0);
  });
});

describe('ticket-triage-agent extractor', () => {
  const wrappedSample = {
    data: {
      tickets: [
        { priority: 'high', sentiment: 'negative' },
        { priority: 'low', sentiment: 'neutral' },
        { priority: 'medium', sentiment: 'positive' },
        { priority: 'critical', sentiment: 'frustrated' },
      ],
      items_processed: 4,
    },
  };

  it('unwraps .data, counts critical/high and negative-leaning sentiment', () => {
    const r = ticketTriage.extract(wrappedSample);
    expect(r.items).toBe(4);
    expect(r.metrics).toEqual({
      tickets_triaged: 4,
      critical_tickets: 1,
      high_priority_tickets: 1,
      sentiment_negative: 2,
    });
  });

  it('falls back to items_processed when tickets array empty', () => {
    const r = ticketTriage.extract({ data: { tickets: [], items_processed: 7 } });
    expect(r.items).toBe(7);
    expect(r.metrics.tickets_triaged).toBe(7);
  });
});

describe('google-sheet-data-checker extractor', () => {
  it('prefers explicit invalid_rows when > 0', () => {
    const r = sheetChecker.extract({
      data: { rows_checked: 100, invalid_rows: 5, issues: [] },
    });
    expect(r.metrics).toEqual({ rows_checked: 100, invalid_rows: 5 });
  });

  it('falls back to issues.length when invalid_rows is zero/missing', () => {
    const r = sheetChecker.extract({
      data: { rows_checked: 50, issues: [{ row: 1 }, { row: 2 }, { row: 3 }] },
    });
    expect(r.metrics.invalid_rows).toBe(3);
  });

  it('postAggregate computes error_rate %', () => {
    const agg = sheetChecker.postAggregate({ rows_checked: 200, invalid_rows: 10 });
    expect(agg.error_rate).toBe(5);
  });

  it('postAggregate returns 0 rate when no rows checked', () => {
    expect(sheetChecker.postAggregate({ rows_checked: 0, invalid_rows: 0 }).error_rate).toBe(0);
  });
});

describe('slack-daily-summary extractor', () => {
  it('handles flat payload (no data wrapper) from current template', () => {
    const r = slackSummary.extract({
      risks: ['x', 'y'],
      action_items: ['a', 'b', 'c'],
      items_processed: 60,
      summary: 'team sync',
    });
    expect(r.items).toBe(60);
    expect(r.metrics).toEqual({
      messages_summarized: 60,
      risks_flagged: 2,
      action_items_created: 3,
    });
  });

  it('also handles wrapped payload if upstream changes', () => {
    const r = slackSummary.extract({
      data: { risks: ['only-one'], action_items: [], items_processed: 12 },
    });
    expect(r.metrics).toEqual({
      messages_summarized: 12,
      risks_flagged: 1,
      action_items_created: 0,
    });
  });

  it('returns zero metrics for empty input', () => {
    const r = slackSummary.extract({});
    expect(r.items).toBe(0);
    expect(r.metrics).toEqual({
      messages_summarized: 0,
      risks_flagged: 0,
      action_items_created: 0,
    });
  });
});
