// Compute the subset of `current` whose values diverge from `defaults`.
// Restricted to `allowedKeys` so callers can't accidentally include non-overridable fields.
export function diffOverrides(
  defaults: Record<string, unknown>,
  current: Record<string, unknown>,
  allowedKeys?: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = allowedKeys ?? Object.keys(current);
  for (const k of keys) {
    if (!(k in current)) continue;
    if (JSON.stringify(defaults[k]) !== JSON.stringify(current[k])) {
      out[k] = current[k];
    }
  }
  return out;
}

export function formatValuePreview(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length === 0 ? '""' : v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
