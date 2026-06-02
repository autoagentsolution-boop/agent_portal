export type HackItem = {
  id: number;
  title: string;
  details: string;
  clipPath: string;            // /files/stock/<hash>.mp4
  narrationAudioPath?: string;
};

export type HacksListProps = {
  topic: string;
  intro: string;
  outro: string;
  channelName?: string;
  hacks: HackItem[];
  variant: 'light' | 'dark';
  introAudioPath?: string;
  outroAudioPath?: string;
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const INTRO_FRAMES = 90;
export const HACK_FRAMES = 360;        // 12s per hack
export const OUTRO_FRAMES = 90;

export const computeHacksDurationInFrames = (hackCount: number): number =>
  INTRO_FRAMES + hackCount * HACK_FRAMES + OUTRO_FRAMES;
