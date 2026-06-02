export type CookingStyle = 'vertical' | 'river' | 'smash';

export type StepIngredient = {
  id: number;
  name: string;
  amount?: string;
  imagePath?: string;     // /files/images/<hash>.png OR external; falls back to disc
  color: string;          // fallback disc tint
};

export type CookingStep = {
  index: number;          // 1..N (display badge)
  title: string;          // "Xương bò"
  instruction: string;    // "Rửa sạch, chần sơ, hầm nhiều giờ"
  ingredients: StepIngredient[];
};

export type CookingExplosionProps = {
  dishName: string;
  subtitle: string;             // "Hành trình tạo nên tô phở bò"
  tagline: string;              // "Tinh hoa ẩm thực Việt Nam"
  channelName?: string;
  dishImagePath?: string;       // bowl photo at bottom
  bowlColor: string;            // fallback bowl gradient color
  steamColor: string;           // sauce/steam ribbon color
  style: CookingStyle;
  steps: CookingStep[];         // ordered, [0] = step 1 (closest to bowl), [last] = top
  variant: 'light' | 'dark';
  // Optional audio — fallback silent. Phase 04+ workflow injects these.
  bgMusicPath?: string;         // looping cinematic instrumental
  narrationPath?: string;       // single-track narration covering whole video
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const INTRO_FRAMES = 60;          // 2s — bowl + title in
export const STEP_REVEAL_FRAMES = 45;    // 1.5s per step layer
export const HOLD_FRAMES = 60;           // 2s — all visible, ribbon full
export const COLLAPSE_FRAMES = 60;       // 2s — ingredients fall into bowl
export const FINAL_FRAMES = 60;          // 2s — dish + CTA

export const computeCookingDurationInFrames = (stepCount: number): number =>
  INTRO_FRAMES + stepCount * STEP_REVEAL_FRAMES + HOLD_FRAMES + COLLAPSE_FRAMES + FINAL_FRAMES;
