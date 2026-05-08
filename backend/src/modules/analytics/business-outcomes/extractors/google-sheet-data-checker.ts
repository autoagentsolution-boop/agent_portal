import { asRecord, safeArray, safeNumber, type Extractor } from '../types.js';

export const extract: Extractor = (output) => {
  const o = asRecord(output);
  const checked = safeNumber(o.rows_checked);
  const invalidExplicit = safeNumber(o.invalid_rows);
  const issues = safeArray(o.issues);
  const invalid = invalidExplicit > 0 ? invalidExplicit : issues.length;

  return {
    items: checked,
    metrics: {
      rows_checked: checked,
      invalid_rows: invalid,
    },
  };
};

export const format = {
  headlineKey: 'invalid_rows',
  labels: {
    rows_checked: 'Rows checked',
    invalid_rows: 'Invalid rows',
    error_rate: 'Error rate',
  },
  suffixes: { error_rate: '%' },
  manualMinutesPerItem: 0.3,
  basis: '20s saved per row validated manually',
};

export function postAggregate(metrics: Record<string, number>): Record<string, number> {
  const total = metrics.rows_checked ?? 0;
  const invalid = metrics.invalid_rows ?? 0;
  const rate = total > 0 ? Number(((invalid / total) * 100).toFixed(2)) : 0;
  return { ...metrics, error_rate: rate };
}
