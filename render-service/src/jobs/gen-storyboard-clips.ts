import { logger } from '../logger.ts';
import { generateMotion, type VeoModel } from './gen-explode-motion.ts';
import { getOrCompute } from '../util/asset-cache.ts';

export interface ClipSpec {
  id: string;
  startImagePath: string;
  prompt: string;
  durationSec?: number;
}

export interface ClipResult {
  id: string;
  cachePath: string;
  cached: boolean;
  durationMs: number;
  freshCostUsd: number;
}

const VEO_LITE_COST = 0.05;
const CLIP_MAX_ATTEMPTS = 3;
const CLIP_BACKOFF_BASE_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isRetryableVeoFailure = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  // Veo "internal server" + transient network/HTTP errors. Skip retry on filter rejection or missing API key.
  return /veo_failed.*code"?:\s*13|internal server|temporarily|UNAVAILABLE|RESOURCE_EXHAUSTED|veo_poll_timeout|UND_ERR/i.test(msg);
};

// Generates one Veo i2v clip per spec, with per-clip caching + per-spec retry on transient Veo failures.
// Cache key includes clip id + startImage SHA + prompt, so different specs map to different cache entries.
export const generateStoryboardClips = async (specs: ClipSpec[]): Promise<ClipResult[]> => {
  const results: ClipResult[] = [];
  for (const s of specs) {
    logger.info('storyboard_clip_start', { id: s.id });

    let lastErr: unknown;
    let cacheResult: Awaited<ReturnType<typeof getOrCompute>> | null = null;
    for (let attempt = 1; attempt <= CLIP_MAX_ATTEMPTS; attempt++) {
      try {
        cacheResult = await getOrCompute(
          {
            namespace: 'storyboard-clip',
            ext: 'mp4',
            inputs: {
              id: s.id,
              startImage: s.startImagePath,
              prompt: s.prompt,
              durationSec: s.durationSec ?? 8,
            },
          },
          async () => {
            const r = await generateMotion({
              imagePath: s.startImagePath,
              prompt: s.prompt,
              durationSeconds: s.durationSec ?? 8,
            });
            return r.buffer;
          },
        );
        break;
      } catch (err) {
        lastErr = err;
        const last = attempt === CLIP_MAX_ATTEMPTS;
        if (last || !isRetryableVeoFailure(err)) throw err;
        const delay = CLIP_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn('storyboard_clip_retry', { id: s.id, attempt, delay, error: String(err).slice(0, 200) });
        await sleep(delay);
      }
    }
    if (!cacheResult) throw (lastErr ?? new Error(`storyboard_clip_unreachable: ${s.id}`));

    const freshCostUsd = cacheResult.cached ? 0 : VEO_LITE_COST;
    logger.info('storyboard_clip_done', { id: s.id, cached: cacheResult.cached, freshCostUsd });
    results.push({
      id: s.id,
      cachePath: cacheResult.path,
      cached: cacheResult.cached,
      durationMs: cacheResult.durationMs,
      freshCostUsd,
    });
  }
  return results;
};

// Build Variant C: 2 clips (cheapest path to spiral storyboard).
export const buildVariantCSpecs = (heroPath: string, compositionPath: string): ClipSpec[] => [
  {
    id: 'C1-explode-spiral-up',
    startImagePath: heroPath,
    prompt: `Cinematic exploded view animation. Camera starts close on the finished Vietnamese pho bo bowl. Over 8 seconds, the bowl breaks apart and all ingredients lift upward in a clockwise spiral, forming a vertical floating column above where the bowl was. Camera simultaneously rises while rotating clockwise around the central liquid vortex. Ingredients suspend frozen mid-air at the end. Dark moody background, warm golden lighting, slow-motion food cinematography. 9:16 vertical. NO text or labels appearing or disappearing — preserve any existing labels exactly.`,
  },
  {
    id: 'C2-spiral-down-implode',
    startImagePath: compositionPath,
    prompt: `Reverse implosion animation. Camera starts on the exploded view of pho bo ingredients suspended around a vertical liquid vortex. Over 8 seconds, all ingredients fall inward counter-clockwise, spiraling downward and converging back into the bowl at the bottom. Camera descends while rotating counter-clockwise. End on the finished pho bo bowl hero shot, steam rising. Dark moody background, warm golden lighting, smooth slow-motion. 9:16 vertical. NO text appearing — labels fade away as ingredients descend.`,
  },
];

// Build Variant B: 5 clips, deeper educational tour (Learn-to-Cook-in-45s tone).
// 3s intro hero hold + 5×8s body tour + 2s outro = 45s.
export const buildVariantBSpecs = (heroPath: string, compositionPath: string): ClipSpec[] => [
  {
    id: 'B1-hero-to-explode',
    startImagePath: heroPath,
    prompt: `Educational cooking video opening. Camera holds close on finished Vietnamese pho bo bowl for 1 second, then over 7 seconds the entire bowl breaks apart upward in a clockwise spiral, ingredients separating and rising into a vertical floating arrangement. Camera ascends while rotating clockwise. End: ingredients suspended around a vertical liquid vortex, ready for ingredient tour. Slow-motion food cinematography, dark moody background, golden rim light. 9:16 vertical. NO text appearing.`,
  },
  {
    id: 'B2-seasoning-broth-closeup',
    startImagePath: compositionPath,
    prompt: `Educational close-up tour through the bottom-layer ingredients of pho bo: salt crystals, rock sugar chunks, fish sauce droplets, beef marrow bone cross-section, beef rib bones, clear golden broth. Camera moves clockwise around the lower section of the exploded view, lingering 1-1.5s on each ingredient with intimate close-up macro shots. Steam and droplets visible. 8 seconds total. Dark moody background, warm golden rim light. 9:16 vertical. Preserve all Vietnamese labels exactly as they appear.`,
  },
  {
    id: 'B3-spices-aromatics-closeup',
    startImagePath: compositionPath,
    prompt: `Educational close-up tour through spices and aromatics of pho bo: clove buds, black cardamom pods, cinnamon sticks, star anise pods, black peppercorns, charred onion, charred ginger, purple shallots. Camera continues clockwise spiral around the middle section, with macro close-ups of each spice's texture and color. Roasted golden tones. 8 seconds. Dark moody background, golden rim light. 9:16 vertical. Preserve labels exactly.`,
  },
  {
    id: 'B4-noodles-meat-herbs-closeup',
    startImagePath: compositionPath,
    prompt: `Educational close-up tour through the upper-layer ingredients of pho bo: white rice noodle bundle, fanned medium-rare beef slices, well-done brisket pieces, fresh bean sprouts, Thai basil leaves, sawtooth coriander, Vietnamese coriander, lime wedge, sliced red chili. Camera continues clockwise spiral around the upper section, with vivid macro close-ups of each ingredient's freshness and color. 8 seconds. Dark moody background, warm golden lighting. 9:16 vertical. Preserve labels exactly.`,
  },
  {
    id: 'B5-implode-to-hero',
    startImagePath: compositionPath,
    prompt: `Reverse spiral implosion. Camera starts on the exploded view of pho bo. Over 8 seconds, all ingredients fall counter-clockwise inward, converging downward into the bowl at the bottom. Camera descends while rotating counter-clockwise. End on the finished pho bo bowl hero shot, steam rising, ready to serve. Cinematic slow-motion. Dark moody background, warm golden lighting. 9:16 vertical. Labels fade away as ingredients descend.`,
  },
];

export type VeoModelHint = VeoModel;
