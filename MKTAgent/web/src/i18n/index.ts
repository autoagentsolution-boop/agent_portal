// Dependency-free i18n runtime (~react + react-dom only — no react-i18next). One plural-free
// interpolation form ({param}), English fallback on any miss, and a typed key union so a wrong key
// is a build error. Deliberately NOT a library: no ICU, no namespaces, no lazy loading. If genuinely
// plural-complex locales (ru, ar) enter the launch set, THAT is the signal to adopt one.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './catalog.en';
import { LOCALE_DEFS, LOCALE_CODES, RTL_CODES } from './locales';

export type { MessageKey } from './catalog.en';
export type Params = Record<string, string | number>;
export type Locale = string;

// Every locale JSON catalog, loaded eagerly at build time (Vite). English is the typed .ts source; the
// rest are data. Keyed by the <code> in the filename (catalog.<code>.json).
const jsonCatalogs = import.meta.glob('./catalog.*.json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
const CATALOGS: Record<string, Partial<Record<MessageKey, string>>> = { en };
for (const [path, cat] of Object.entries(jsonCatalogs)) {
  const code = path.replace('./catalog.', '').replace('.json', '');
  CATALOGS[code] = cat as Partial<Record<MessageKey, string>>;
}

// A locale is OFFERED only once it has a non-empty catalog (English always). A language added to
// locales.ts but not yet generated simply doesn't appear — English never disappears.
export const UI_LOCALES: Locale[] = LOCALE_CODES.filter(
  (c) => c === 'en' || (CATALOGS[c] && Object.keys(CATALOGS[c]!).length > 0),
);
// Native names (endonyms) for the switcher — a language name is shown in its OWN language, from
// locales.ts (the single source).
export const LOCALE_ENDONYMS: Record<string, string> = Object.fromEntries(LOCALE_DEFS.map((l) => [l.code, l.endonym]));

const isLocale = (v: string): v is Locale => UI_LOCALES.includes(v);

// Active locale = user.uiLanguage (set later by the app) → navigator.language base tag → 'en'.
export const resolveInitialLocale = (): Locale => {
  const base = (navigator.language || 'en').toLowerCase().split('-')[0];
  return isLocale(base) ? base : 'en';
};

const interpolate = (template: string, params?: Params): string =>
  params ? template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : template;

// Core lookup: active locale → English → the key itself (last resort; a key surfacing to a user is a
// bug, but it is never blank). Dev-only warn on an English miss so gaps are visible during migration.
export const translate = (locale: Locale, key: MessageKey, params?: Params): string => {
  const hit = CATALOGS[locale]?.[key] ?? en[key];
  if (hit === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  return interpolate(hit, params);
};

// Module-level active locale + t(), for imperative call sites (event handlers, tError) that cannot
// use the hook. LocaleProvider keeps this in sync with the reactive context locale.
let activeLocale: Locale = 'en';
export const setActiveLocale = (l: Locale): void => { activeLocale = l; };
export const getActiveLocale = (): Locale => activeLocale;
export const t = (key: MessageKey, params?: Params): string => translate(activeLocale, key, params);

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, params?: Params) => string;
}
const Ctx = createContext<LocaleCtx | null>(null);

// Provider holds {locale, t} in a useMemo so `t` identity changes ONLY on a locale change — subscribers
// re-render, unrelated state does not. Mirrors the locale to the module-level active locale.
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  // Keep the module-level active locale in sync, and flip the document direction for RTL scripts
  // (ar/he/fa/ur) so their text lays out right-to-left.
  useEffect(() => {
    setActiveLocale(locale);
    if (typeof document !== 'undefined') document.documentElement.dir = RTL_CODES.has(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(isLocale(l) ? l : 'en'), []);
  const value = useMemo<LocaleCtx>(
    () => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }),
    [locale, setLocale],
  );
  return createElement(Ctx.Provider, { value }, children);
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocale must be used within <LocaleProvider>');
  return ctx;
}
