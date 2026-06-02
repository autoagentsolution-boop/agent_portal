export type QuizVariant = 'light' | 'dark';

export type QuizQuestion = {
  id: number;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  questionAudioPath?: string;
  revealAudioPath?: string;
};

export type QuizProps = {
  title: string;
  channelName?: string;
  questions: QuizQuestion[];
  variant: QuizVariant;
  bgMusicPath?: string;
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const INTRO_FRAMES = 90;
export const QUESTION_FRAMES = 180;
export const OUTRO_FRAMES = 60;

export const computeDurationInFrames = (questionCount: number): number =>
  INTRO_FRAMES + questionCount * QUESTION_FRAMES + OUTRO_FRAMES;
