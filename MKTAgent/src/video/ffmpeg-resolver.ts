// ffmpeg resolution + pre-flight (F21). The video path shells out to ffmpeg twice (stitch + audio mux);
// on Windows, a background/service launcher can hand the Node process a scrubbed PATH so `spawn('ffmpeg')`
// dies with STATUS_DLL_INIT_FAILED (0xC0000142) or ENOENT — AFTER the run has already spent ~$1 on
// keyframes + Veo clips, producing no deliverable. This module gives ONE resolved binary path (env
// override → PATH default) and a cheap `ffmpeg -version` pre-flight the video runner calls BEFORE any
// paid media, so a broken ffmpeg fails fast + actionable instead of at the stitch step.
import { spawn } from 'node:child_process';
import { env } from '../config/env.ts';

// The configured/default ffmpeg binary. 'ffmpeg' (default) resolves via PATH; an absolute FFMPEG_PATH
// bypasses PATH entirely for scrubbed-env launchers. Read live from process.env (falling back to the
// boot-parsed default) so an ops fix — or a test — can point it elsewhere without a process restart.
export const ffmpegBin = (): string => {
  const override = (process.env.FFMPEG_PATH ?? '').trim();
  return override || env.FFMPEG_PATH;
};

export class FfmpegUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(
      `ffmpeg is not runnable (${detail}). Video rendering needs ffmpeg to stitch clips. ` +
        `Install ffmpeg and put it on PATH, or set FFMPEG_PATH to its absolute path in the environment ` +
        `(on Windows a background/service launcher often runs with a scrubbed PATH — an absolute FFMPEG_PATH fixes it).`,
    );
    this.name = 'FfmpegUnavailableError';
  }
}

// Cache a successful pre-flight for the lifetime of the process (the binary doesn't move mid-run). A
// FAILURE is not cached — a mid-session PATH/config fix should be picked up on the next attempt.
let verifiedBin: string | null = null;

// Run `<bin> -version`, resolving to a short diagnostic string on failure (spawn error code or non-zero
// exit) or null on success. Never throws — the caller decides how to surface it.
const probe = (bin: string): Promise<string | null> =>
  new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const ff = spawn(bin, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] });
      // A hung spawn must not block a run forever; 5s is generous for `-version`.
      const timer = setTimeout(() => { try { ff.kill(); } catch { /* noop */ } done('timed out'); }, 5000);
      ff.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(timer); done(e.code ? `${e.code}: ${e.message}` : e.message); });
      ff.on('close', (code) => { clearTimeout(timer); done(code === 0 ? null : `exit ${code} (0x${(code! >>> 0).toString(16)})`); });
    } catch (e) {
      done(e instanceof Error ? e.message : String(e));
    }
  });

// Pre-flight: verify the resolved ffmpeg actually runs. Throws FfmpegUnavailableError with an actionable
// message when it can't. Cheap (spawns `ffmpeg -version` once, then memoized), so the video runner can
// call it at the top before any billable keyframe/Veo call.
export const ensureFfmpeg = async (): Promise<string> => {
  const bin = ffmpegBin();
  if (verifiedBin === bin) return bin;
  const failure = await probe(bin);
  if (failure) throw new FfmpegUnavailableError(`${bin} → ${failure}`);
  verifiedBin = bin;
  return bin;
};

// Test seam: reset the memoized pre-flight (used by verify-ffmpeg-preflight.ts so successive probes with
// different FFMPEG_PATH values are not masked by the cache).
export const _resetFfmpegProbeCache = (): void => { verifiedBin = null; };
