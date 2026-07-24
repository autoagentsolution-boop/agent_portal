// The launch set of INTERFACE languages (i18n track). UI strings need hand-shipped catalogs, so this
// is a small allow-list — NOT the 31 content languages the copy generator writes for free. Add a code
// here only when web/src/i18n/catalog.<code>.ts exists and is non-empty. Server-side source of truth
// for validating PATCH /auth/me { uiLanguage }; the client catalog set must stay in sync.
export const UI_LANGUAGES = ['en', 'vi', 'id', 'ko'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const isUiLanguage = (v: unknown): v is UiLanguage =>
  typeof v === 'string' && (UI_LANGUAGES as readonly string[]).includes(v);
