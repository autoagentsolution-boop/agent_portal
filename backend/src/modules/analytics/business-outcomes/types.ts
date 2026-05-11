export interface BusinessMetric {
  key: string;
  label: string;
  value: number;
  suffix?: string;
}

export interface ExtractedMetrics {
  items: number;
  metrics: Record<string, number>;
}

export type Extractor = (output: unknown) => ExtractedMetrics;

export interface OutcomeFormatter {
  headlineKey: string;
  labels: Record<string, string>;
  suffixes?: Record<string, string>;
  manualMinutesPerItem: number;
  basis: string;
}

export interface RegistryEntry {
  extract: Extractor;
  format: OutcomeFormatter;
}

export function safeNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function safeArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

// n8n wraps execution output as `{ data: {...}, summary: "..." }` for most templates.
// Some templates (slack-daily-summary) emit flat payloads. Unwrap when present, fall back to raw.
export function unwrapData(v: unknown): Record<string, unknown> {
  const raw = asRecord(v);
  const inner = raw.data;
  return inner && typeof inner === 'object' && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : raw;
}
