// Dependency-free i18n runtime (~react + react-dom only — no react-i18next). One plural-free
// interpolation form ({param}), English fallback on any miss, and a typed key union so a wrong key
// is a build error. Deliberately NOT a library: no ICU, no namespaces, no lazy loading. If genuinely
// plural-complex locales (ru, ar) enter the launch set, THAT is the signal to adopt one.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './catalog.en';
import { vi } from './catalog.vi';
import { id } from './catalog.id';
import { ko } from './catalog.ko';

export type { MessageKey } from './catalog.en';
export type Params = Record<string, string | number>;

// Launch set. A locale is offered only when its catalog file exists — keep in sync with the server
// allow-list in src/i18n/ui-languages.ts (PATCH /auth/me validates against that).
export const UI_LOCALES = ['en', 'vi', 'id', 'ko'] as const;
export type Locale = (typeof UI_LOCALES)[number];

const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, vi, id, ko };

const isLocale = (v: string): v is Locale => (UI_LOCALES as readonly string[]).includes(v);

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

  useEffect(() => { setActiveLocale(locale); }, [locale]);

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
