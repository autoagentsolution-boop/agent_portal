// verify-ffmpeg-preflight — F21. Pins the ffmpeg resolver + pre-flight contract so a Windows
// scrubbed-PATH spawn failure surfaces BEFORE any paid media, not after. Unit tier (no DB, no network
// beyond spawning the local ffmpeg once). Exits non-zero on any failed check.
import { ensureFfmpeg, ffmpegBin, FfmpegUnavailableError, _resetFfmpegProbeCache } from '../video/ffmpeg-resolver.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

console.log('ffmpeg resolver + pre-flight (F21)');

// 1. Default resolution → 'ffmpeg' (PATH) unless FFMPEG_PATH overrides. This run inherits the shell PATH
//    (ffmpeg present on this dev box + the Docker image), so ensureFfmpeg must succeed.
check('ffmpegBin() defaults to the configured/env value', typeof ffmpegBin() === 'string' && ffmpegBin().length > 0, ffmpegBin());

try {
  const bin = await ensureFfmpeg();
  check('ensureFfmpeg resolves when ffmpeg is on PATH', bin === ffmpegBin(), bin);
} catch (e) {
  // If ffmpeg is genuinely absent from PATH in this environment, the pre-flight SHOULD throw the typed,
  // actionable error — that is the contract, so treat it as a pass for the type + message, not a hard fail.
  check('ensureFfmpeg throws the typed FfmpegUnavailableError when ffmpeg is missing', e instanceof FfmpegUnavailableError, String(e).slice(0, 120));
  check('the error names the FFMPEG_PATH remedy', e instanceof Error && /FFMPEG_PATH/.test(e.message), e instanceof Error ? e.message.slice(0, 160) : e);
}

// 2. A BOGUS absolute path must fail the pre-flight with the actionable error (this is the exact
//    scrubbed-PATH / STATUS_DLL_INIT_FAILED failure mode, forced deterministically). ffmpegBin() reads
//    FFMPEG_PATH live from process.env, so setting it + resetting the probe cache is enough — no module
//    re-import needed.
const BOGUS = process.platform === 'win32' ? 'C:\\definitely\\not\\ffmpeg.exe' : '/definitely/not/ffmpeg';
process.env.FFMPEG_PATH = BOGUS;
_resetFfmpegProbeCache();
check('ffmpegBin() honors the FFMPEG_PATH override', ffmpegBin() === BOGUS, ffmpegBin());
{
  let threw: unknown = null;
  try { await ensureFfmpeg(); } catch (e) { threw = e; }
  check('bogus FFMPEG_PATH → pre-flight throws (fails fast, not at stitch)', threw instanceof FfmpegUnavailableError, threw && (threw as Error).name);
  check('bogus FFMPEG_PATH error is actionable (names FFMPEG_PATH + install)', threw instanceof Error && /FFMPEG_PATH/.test(threw.message) && /[Ii]nstall/.test(threw.message), threw instanceof Error ? threw.message.slice(0, 180) : threw);
}
delete process.env.FFMPEG_PATH;
_resetFfmpegProbeCache();

console.log(failures === 0 ? '\nPASS — ffmpeg pre-flight checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
