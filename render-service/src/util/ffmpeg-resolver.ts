import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

let cached: string | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REMOTION_CANDIDATES = [
  path.resolve(__dirname, '..', '..', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
  path.resolve(__dirname, '..', '..', 'node_modules', '@remotion', 'compositor-linux-x64-gnu', 'ffmpeg'),
  path.resolve(__dirname, '..', '..', 'node_modules', '@remotion', 'compositor-darwin-arm64', 'ffmpeg'),
  path.resolve(__dirname, '..', '..', 'node_modules', '@remotion', 'compositor-darwin-x64', 'ffmpeg'),
];

const trySystemFfmpeg = (): boolean => {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
};

// Winget installs Gyan.FFmpeg under %LOCALAPPDATA%/Microsoft/WinGet/Packages/
// with a versioned dir like ffmpeg-8.1.1-full_build/bin/ffmpeg.exe.
const findWingetFfmpeg = (): string | null => {
  if (process.platform !== 'win32') return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const pkgDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!existsSync(pkgDir)) return null;
  try {
    const dirs = readdirSync(pkgDir, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory() || !d.name.startsWith('Gyan.FFmpeg')) continue;
      const pkgRoot = path.join(pkgDir, d.name);
      const inner = readdirSync(pkgRoot, { withFileTypes: true });
      for (const i of inner) {
        if (!i.isDirectory() || !i.name.startsWith('ffmpeg-')) continue;
        const candidate = path.join(pkgRoot, i.name, 'bin', 'ffmpeg.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
};

export const resolveFfmpeg = (): string => {
  if (cached) return cached;

  const explicit = process.env.FFMPEG_BIN;
  if (explicit && existsSync(explicit)) {
    cached = explicit;
    return cached;
  }

  if (trySystemFfmpeg()) {
    cached = 'ffmpeg';
    return cached;
  }

  const winget = findWingetFfmpeg();
  if (winget) {
    cached = winget;
    return cached;
  }

  for (const c of REMOTION_CANDIDATES) {
    if (existsSync(c)) {
      cached = c;
      return cached;
    }
  }

  throw new Error('ffmpeg_not_found: set FFMPEG_BIN env var or install ffmpeg on PATH');
};
