import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from './logger.ts';
import { serialize } from './queue.ts';
import { logRun, markJobRendered } from './db.ts';
import { KNOWN_TEMPLATES, render, warmBundle } from './render.ts';
import { ttsRouter } from './routes/tts.ts';
import { imageRouter } from './routes/image.ts';
import { stockRouter } from './routes/stock.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const PORT = Number(process.env.PORT ?? 7000);
const RENDER_SECRET = process.env.RENDER_SECRET ?? '';

if (!RENDER_SECRET) {
  logger.warn('render_secret_missing', { note: 'POST /render will reject all calls' });
}

const renderSchema = z.object({
  template: z.enum(KNOWN_TEMPLATES),
  props: z.record(z.unknown()).default({}),
  jobId: z.string().uuid(),
});

const requireSecret = (req: Request, res: Response): boolean => {
  const header = req.header('x-internal-secret');
  if (!RENDER_SECRET || header !== RENDER_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
};

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/files', express.static(OUTPUT_DIR, { fallthrough: false }));

const requireSecretMw = (req: Request, res: Response, next: () => void): void => {
  if (requireSecret(req, res)) next();
};
app.use('/tts', requireSecretMw, ttsRouter);
app.use('/image', requireSecretMw, imageRouter);
app.use('/stock', requireSecretMw, stockRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, bundleReady: false });
});

app.post('/render', async (req, res, next) => {
  if (!requireSecret(req, res)) return;

  const parsed = renderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  const { template, props, jobId } = parsed.data;

  try {
    await logRun(jobId, 'info', 'render', { phase: 'queued', template });
    const result = await serialize(async () => {
      await logRun(jobId, 'info', 'render', { phase: 'started', template });
      const out = await render(template, props, jobId);
      await markJobRendered(jobId, out.videoPath);
      await logRun(jobId, 'info', 'render', { phase: 'done', durationMs: out.durationMs });
      return out;
    });
    res.json({ videoPath: result.videoPath, durationMs: result.durationMs });
  } catch (err) {
    await logRun(jobId, 'error', 'render', { error: String(err) }).catch(() => undefined);
    next(err);
  }
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error('render_failed', { error: String(err) });
  res.status(500).json({ error: 'render_failed', retryable: true });
};
app.use(errorHandler);

const bootstrap = async (): Promise<void> => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  app.listen(PORT, () => {
    logger.info('render_service_listening', { port: PORT });
  });
  // Pre-warm Remotion bundle in background so first /render isn't 30s slower.
  warmBundle().catch((err: unknown) => {
    logger.error('warm_bundle_failed', { error: String(err) });
  });
};

bootstrap().catch((err: unknown) => {
  logger.error('bootstrap_failed', { error: String(err) });
  process.exit(1);
});
