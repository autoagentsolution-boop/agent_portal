import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { logger } from './logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.resolve(__dirname, 'templates/index.tsx');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');

export const KNOWN_TEMPLATES = ['QuizCountdown', 'NewsComic', 'HacksList'] as const;
export type TemplateName = (typeof KNOWN_TEMPLATES)[number];

let bundlePromise: Promise<string> | null = null;

// Bundle Remotion compositions once at startup; reuse across renders to avoid
// 20-30s rebundle penalty per call.
export const warmBundle = (): Promise<string> => {
  if (!bundlePromise) {
    logger.info('remotion_bundle_start', { entryPoint: ENTRY_POINT });
    const started = Date.now();
    bundlePromise = bundle({ entryPoint: ENTRY_POINT })
      .then((serveUrl) => {
        logger.info('remotion_bundle_ready', { ms: Date.now() - started });
        return serveUrl;
      })
      .catch((err: unknown) => {
        bundlePromise = null;
        logger.error('remotion_bundle_failed', { error: String(err) });
        throw err;
      });
  }
  return bundlePromise;
};

export interface RenderResult {
  videoPath: string;
  durationMs: number;
  outputFile: string;
}

export const render = async (
  template: TemplateName,
  props: Record<string, unknown>,
  jobId: string,
): Promise<RenderResult> => {
  const started = Date.now();
  const serveUrl = await warmBundle();
  const composition = await selectComposition({ serveUrl, id: template, inputProps: props });
  const outputFile = path.join(OUTPUT_DIR, `${jobId}.mp4`);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputFile,
    inputProps: props,
  });

  return {
    outputFile,
    videoPath: `/files/${jobId}.mp4`,
    durationMs: Date.now() - started,
  };
};
