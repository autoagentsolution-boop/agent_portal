// Concatenate N mp4 clips into one mp4 using ffmpeg (concat demuxer, stream copy — no
// re-encode, fast + lossless as long as the clips share codec/params, which Veo clips do).
// ffmpeg must be on PATH (installed in the Docker image). A single clip is returned as-is.
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { VIDEO_OUTPUT_DIR } from './veo.ts';

const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += String(d); });
    ff.on('error', (e) => reject(new Error(`ffmpeg spawn failed: ${e.message} (is ffmpeg installed?)`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`))));
  });

// Stitch clips in the given order into one mp4. Returns the output path. 0 clips → throws;
// 1 clip → returns that clip unchanged (no ffmpeg needed).
export const stitchClips = async (clipPaths: string[]): Promise<string> => {
  if (clipPaths.length === 0) throw new Error('stitch: no clips');
  if (clipPaths.length === 1) return clipPaths[0]!;

  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
  const key = createHash('sha256').update(clipPaths.join('|')).digest('hex').slice(0, 24);
  const outputFile = path.join(VIDEO_OUTPUT_DIR, `stitch-${key}.mp4`);

  // concat demuxer needs a list file of absolute paths.
  const listFile = path.join(VIDEO_OUTPUT_DIR, `concat-${key}.txt`);
  const listBody = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listFile, listBody);

  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile]);
  return outputFile;
};
