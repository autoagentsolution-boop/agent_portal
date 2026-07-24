// Interface-language picker for the top nav. Changes uiLanguage — the INTERFACE language, distinct
// from the content language Atria writes in. Optimistic: applies the locale immediately (setLocale),
// then persists via PATCH /auth/me so it survives reload; a failed persist reverts and toasts.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useLocale, UI_LOCALES, LOCALE_ENDONYMS, type Locale } from '../i18n';

export function LanguageSwitcher({ onError }: { onError?: (msg: string) => void }) {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = async (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    const prev = locale;
    setLocale(next);
    const r = await api.setUiLanguage(next);
    if (!r.ok) { setLocale(prev); onError?.(t('err.generic')); }
  };

  return (
    <div className="topnav-lang" ref={ref}>
      <button
        className="topnav-item"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('account.language.label')}
      >
        🌐 <span className="topnav-item-label">{LOCALE_ENDONYMS[locale]}</span> <span className="topnav-caret">▾</span>
      </button>
      {open && (
        <div className="topnav-lang-panel" role="menu">
          {UI_LOCALES.map((code) => (
            <button
              key={code}
              className={`topnav-lang-row ${code === locale ? 'is-active' : ''}`}
              role="menuitemradio"
              aria-checked={code === locale}
              onClick={() => void pick(code)}
            >
              {LOCALE_ENDONYMS[code]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
