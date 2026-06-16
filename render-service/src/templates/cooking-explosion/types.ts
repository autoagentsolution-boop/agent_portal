export type CookingStyle = 'vertical' | 'river' | 'smash';

export type StepIngredient = {
  id: number;
  name: string;
  amount?: string;        // portion: "1.5kg", "2 thanh", "3 cánh"
  prep?: string;          // short prep instruction: "Rửa muối, chần sôi bỏ nước đầu"
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

// ---- Storyboard v2 (ChatGPT-authored multi-panel) ----
export type PanelTransition = 'cut' | 'fade' | 'zoom' | 'swipe';
export type PanelKindRender = 'intro' | 'step' | 'outro';

export type PanelV2Render = {
  index: number;
  kind: PanelKindRender;
  imagePath: string;                       // staticFile() path, e.g. "storyboard-v2/bo-kho/panel-01.png"
  audioPath?: string;                      // narration mp3 — optional, silent if absent
  motionPath?: string;                     // Veo i2v mp4 — when present, replaces image
  durationSec: number;
  transition: PanelTransition;
  imageTextLabel: { line1: string; line2: string | null; line3: string | null };
};

export type CookingExplosionV2Props = {
  schemaVersion: 'v2';
  dishName: string;
  channelName?: string;
  variant: 'light' | 'dark';
  panels: PanelV2Render[];
  bgMusicPath?: string;
};

export type CookingExplosionAnyProps = CookingExplosionProps | CookingExplosionV2Props;

export const isV2Props = (p: CookingExplosionAnyProps): p is CookingExplosionV2Props =>
  (p as CookingExplosionV2Props).schemaVersion === 'v2';

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

export const computeCookingV2DurationInFrames = (panels: PanelV2Render[]): number =>
  panels.reduce((acc, p) => acc + Math.round(p.durationSec * FPS), 0);
