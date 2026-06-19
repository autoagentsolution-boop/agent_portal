import { logger } from '../logger.ts';
import { type VeoModel } from './gen-explode-motion.ts';
import { getOrCompute } from '../util/asset-cache.ts';
import { type VideoBackend, veoBackend } from './video-backends.ts';

export interface ClipSpec {
  id: string;
  startImagePath: string;
  prompt: string;
  durationSec?: number;
  // Veo-only: 'lite' (cheap, $0.05/sec, 2 RPM Tier 1) or 'fast' (better motion, $0.10/sec).
  // Undefined = legacy auto behavior (try lite first, fallback fast on quota).
  // Included in cache key so re-routing the same panel forces a fresh gen at the chosen model.
  modelHint?: 'lite' | 'fast';
}

export interface ClipResult {
  id: string;
  cachePath: string;
  cached: boolean;
  durationMs: number;
  freshCostUsd: number;
}

const CLIP_MAX_ATTEMPTS = 3;
const CLIP_BACKOFF_BASE_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Generates one i2v clip per spec, with per-clip caching + per-spec retry on transient backend failures.
// Cache key includes clip id + startImage SHA + prompt + provider, so different backends do not cross-hit.
// Backend defaults to Veo for backward compatibility — pass klingBackend (or via VIDEO_PROVIDER env in motion-v2.ts) to switch.
//
// Inter-call throttling: after each FRESH generation (non-cached), sleeps backend.interCallDelayMs()
// before the next spec. Veo Tier 1 caps at 2 RPM, so default 35s prevents 429s mid-batch.
// Cached hits skip the sleep — re-runs after cache fill don't pay the throttling tax.
export const generateStoryboardClips = async (
  specs: ClipSpec[],
  backend: VideoBackend = veoBackend,
): Promise<ClipResult[]> => {
  const results: ClipResult[] = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    logger.info('storyboard_clip_start', { id: s.id, provider: backend.name });

    let lastErr: unknown;
    let cacheResult: Awaited<ReturnType<typeof getOrCompute>> | null = null;
    for (let attempt = 1; attempt <= CLIP_MAX_ATTEMPTS; attempt++) {
      try {
        cacheResult = await getOrCompute(
          {
            namespace: backend.cacheNamespace,
            ext: 'mp4',
            inputs: {
              id: s.id,
              startImage: s.startImagePath,
              prompt: s.prompt,
              durationSec: s.durationSec ?? backend.snapDuration(8),
              provider: backend.name,
              ...(s.modelHint ? { modelHint: s.modelHint } : {}),
            },
          },
          async () => {
            const buffer = await backend.generate({
              imagePath: s.startImagePath,
              prompt: s.prompt,
              durationSeconds: s.durationSec ?? backend.snapDuration(8),
              modelHint: s.modelHint,
            });
            return buffer;
          },
        );
        break;
      } catch (err) {
        lastErr = err;
        const last = attempt === CLIP_MAX_ATTEMPTS;
        if (last || !backend.isRetryable(err)) throw err;
        const delay = CLIP_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn('storyboard_clip_retry', { id: s.id, provider: backend.name, attempt, delay, error: String(err).slice(0, 200) });
        await sleep(delay);
      }
    }
    if (!cacheResult) throw (lastErr ?? new Error(`storyboard_clip_unreachable: ${s.id}`));

    const durationForBilling = s.durationSec ?? backend.snapDuration(8);
    const freshCostUsd = cacheResult.cached ? 0 : backend.computeCostUsd(durationForBilling, s.modelHint);
    logger.info('storyboard_clip_done', { id: s.id, provider: backend.name, cached: cacheResult.cached, freshCostUsd });
    results.push({
      id: s.id,
      cachePath: cacheResult.path,
      cached: cacheResult.cached,
      durationMs: cacheResult.durationMs,
      freshCostUsd,
    });

    // Throttle: only after a FRESH call AND not last spec. Cached hits = no API used = no need to sleep.
    const isLast = i === specs.length - 1;
    if (!cacheResult.cached && !isLast) {
      const delayMs = backend.interCallDelayMs();
      if (delayMs > 0) {
        logger.info('storyboard_clip_throttle', { provider: backend.name, delayMs, nextId: specs[i + 1]!.id });
        await sleep(delayMs);
      }
    }
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
