export type ComicPanel = {
  panel: number;
  caption: string;
  imagePath: string;            // /files/images/<hash>.png OR external URL
  captionAudioPath?: string;
};

export type NewsComicProps = {
  title: string;
  channelName?: string;
  panels: ComicPanel[];
  bgMusicPath?: string;
  variant: 'light' | 'dark';
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const INTRO_FRAMES = 60;
export const PANEL_FRAMES = 135;   // 4.5s per panel
export const OUTRO_FRAMES = 60;

export const computeNewsComicDurationInFrames = (panelCount: number): number =>
  INTRO_FRAMES + panelCount * PANEL_FRAMES + OUTRO_FRAMES;
