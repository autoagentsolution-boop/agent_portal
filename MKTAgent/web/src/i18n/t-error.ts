// Single place that turns an API error envelope into a user sentence. Every component renders errors
// through this — no component decides what to do with an unknown code. A known code → its remedy
// sentence; an unknown code → a generic sentence WITH the raw code appended in parentheses, so support
// can still triage what the user pasted. Uses the module-level active locale (no hook needed in the
// event handlers that call it).
import { t, type MessageKey } from './index';
import { en } from './catalog.en';

export interface ApiErrorLike {
  error: string; // stable code, e.g. 'gmail_not_connected'
  params?: Record<string, string | number>;
}

export const tError = (err: ApiErrorLike | undefined | null): string => {
  const code = err?.error ?? 'generic';
  const key = `err.${code}` as MessageKey;
  if (key in en) return t(key, err?.params);
  // Unknown code: readable fallback, but keep the raw code visible for support.
  return `${t('err.generic')} (${code})`;
};
