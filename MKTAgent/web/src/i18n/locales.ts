// SINGLE SOURCE OF TRUTH for UI locales. Add a language = one row here + run
// `npm run i18n:translate -- --locale <code>` (writes catalog.<code>.json). Everything derives from
// this list: the switcher, the provider, the server allow-list, verify-i18n, and the pipeline. No
// per-language wiring anywhere else.
//
// `endonym` is the language's own name (shown untranslated in the switcher). `name` is the English
// name (only the generator prompt uses it). `rtl` flips the document direction for right-to-left
// scripts. `en` is the source catalog (catalog.en.ts) and needs no JSON file.
export interface LocaleDef {
  code: string;
  endonym: string;
  name: string;
  rtl?: boolean;
}

export const LOCALE_DEFS: LocaleDef[] = [
  { code: 'en', endonym: 'English', name: 'English' },
  { code: 'vi', endonym: 'Tiếng Việt', name: 'Vietnamese' },
  { code: 'th', endonym: 'ไทย', name: 'Thai' },
  { code: 'ja', endonym: '日本語', name: 'Japanese' },
  { code: 'ko', endonym: '한국어', name: 'Korean' },
  { code: 'zh', endonym: '简体中文', name: 'Simplified Chinese' },
  { code: 'zh-TW', endonym: '繁體中文', name: 'Traditional Chinese' },
  { code: 'id', endonym: 'Bahasa Indonesia', name: 'Indonesian' },
  { code: 'ms', endonym: 'Bahasa Melayu', name: 'Malay' },
  { code: 'tl', endonym: 'Filipino', name: 'Filipino' },
  { code: 'km', endonym: 'ភាសាខ្មែរ', name: 'Khmer' },
  { code: 'lo', endonym: 'ລາວ', name: 'Lao' },
  { code: 'my', endonym: 'မြန်မာ', name: 'Burmese' },
  { code: 'es', endonym: 'Español', name: 'Spanish' },
  { code: 'pt', endonym: 'Português', name: 'Portuguese' },
  { code: 'fr', endonym: 'Français', name: 'French' },
  { code: 'de', endonym: 'Deutsch', name: 'German' },
  { code: 'it', endonym: 'Italiano', name: 'Italian' },
  { code: 'nl', endonym: 'Nederlands', name: 'Dutch' },
  { code: 'ru', endonym: 'Русский', name: 'Russian' },
  { code: 'uk', endonym: 'Українська', name: 'Ukrainian' },
  { code: 'pl', endonym: 'Polski', name: 'Polish' },
  { code: 'tr', endonym: 'Türkçe', name: 'Turkish' },
  { code: 'hi', endonym: 'हिन्दी', name: 'Hindi' },
  { code: 'bn', endonym: 'বাংলা', name: 'Bengali' },
  { code: 'ta', endonym: 'தமிழ்', name: 'Tamil' },
  { code: 'ur', endonym: 'اردو', name: 'Urdu', rtl: true },
  { code: 'fa', endonym: 'فارسی', name: 'Persian', rtl: true },
  { code: 'ar', endonym: 'العربية', name: 'Arabic', rtl: true },
  { code: 'he', endonym: 'עברית', name: 'Hebrew', rtl: true },
];

export const LOCALE_CODES = LOCALE_DEFS.map((l) => l.code);
export const RTL_CODES = new Set(LOCALE_DEFS.filter((l) => l.rtl).map((l) => l.code));
