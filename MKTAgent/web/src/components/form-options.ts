import type { Dto } from '../api/client';

export type SocialPlatform = Dto['SocialPlatform'];
export type AssetType = Dto['AssetType'];

export const platformOptions: Array<{ value: SocialPlatform; label: string }> = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'threads', label: 'Threads' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X' },
];

export const assetTypeOptions: Array<{ value: AssetType; label: string; hint: string }> = [
  { value: 'image', label: 'Image', hint: '1 Drive file ID' },
  { value: 'carousel', label: 'Carousel', hint: '2-10 file IDs, comma separated' },
  { value: 'video', label: 'Video', hint: '1 Drive video file ID' },
];

// Which asset types each platform can actually publish (item 5) — MIRRORS the backend
// social adapters' `supports` (FB does all; the others are image-only today). Used to
// constrain the per-platform asset picker so a user can't pick carousel/video where the
// adapter can't send it. Keep in lock-step with src/social/*.ts adapters.
export const platformAssetSupport: Record<SocialPlatform, AssetType[]> = {
  facebook: ['image', 'carousel', 'video'],
  instagram: ['image'],
  threads: ['image'],
  linkedin: ['image'],
  x: ['image'],
};

// Language is FREE-FORM (T3). The campaign select uses the '' "inherit" entry; the post brief is a
// text input with these as datalist hints (filters out ''), so any language/dialect works uncoded.
// Labels are the NATIVE endonym first (what the user reads), English gloss in parens for the less
// common ones — the picker should never surface a bare ISO code to the user (feedback 4a).
export const languageOptions = [
  { value: '', label: 'Inherit default' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
  { value: 'th', label: 'ไทย (Thai)' },
  { value: 'ja', label: '日本語 (Japanese)' },
  { value: 'ko', label: '한국어 (Korean)' },
  { value: 'zh', label: '中文 (Chinese, Simplified)' },
  { value: 'zh-TW', label: '繁體中文 (Chinese, Traditional)' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'tl', label: 'Filipino (Tagalog)' },
  { value: 'km', label: 'ភាសាខ្មែរ (Khmer)' },
  { value: 'lo', label: 'ພາສາລາວ (Lao)' },
  { value: 'my', label: 'မြန်မာ (Burmese)' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'pt', label: 'Português (Portuguese)' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'it', label: 'Italiano (Italian)' },
  { value: 'nl', label: 'Nederlands (Dutch)' },
  { value: 'ru', label: 'Русский (Russian)' },
  { value: 'uk', label: 'Українська (Ukrainian)' },
  { value: 'pl', label: 'Polski (Polish)' },
  { value: 'tr', label: 'Türkçe (Turkish)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'bn', label: 'বাংলা (Bengali)' },
  { value: 'ta', label: 'தமிழ் (Tamil)' },
  { value: 'ur', label: 'اردو (Urdu)' },
  { value: 'fa', label: 'فارسی (Persian)' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'he', label: 'עברית (Hebrew)' },
];

// code → native label (feedback 4a: the brief showed "Inherit → vi", a raw code). Falls back to the
// code itself for any free-form language not in the list.
const LANG_LABEL = new Map(languageOptions.filter((o) => o.value).map((o) => [o.value, o.label] as const));
export const nativeLanguageLabel = (code: string): string => LANG_LABEL.get(code.trim()) ?? code.trim();

export const lengthOptions = [
  { value: '', label: 'Inherit default' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
  { value: '120', label: '~120 words' },
  { value: '250', label: '~250 words' },
];

export const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const toLocalDateTimeInput = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const fromLocalDateTimeInput = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
