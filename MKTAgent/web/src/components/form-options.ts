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

export const languageOptions = [
  { value: '', label: 'Inherit default' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
  { value: 'th', label: 'Thai' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
];

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
