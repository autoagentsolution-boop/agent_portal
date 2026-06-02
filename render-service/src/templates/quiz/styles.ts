import type { QuizVariant } from './types.ts';

export type Theme = {
  bg: string;
  primary: string;
  text: string;
  muted: string;
  card: string;
  correct: string;
};

export const themes: Record<QuizVariant, Theme> = {
  light: {
    bg: '#FFF8E7',
    primary: '#FF6B35',
    text: '#1a1a1a',
    muted: '#666',
    card: '#FFFFFF',
    correct: '#16A34A',
  },
  dark: {
    bg: '#1a1a2e',
    primary: '#FFD23F',
    text: '#FFFFFF',
    muted: '#A0A0B0',
    card: '#2A2A40',
    correct: '#4ADE80',
  },
};

export const fontStack =
  "'Be Vietnam Pro', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
