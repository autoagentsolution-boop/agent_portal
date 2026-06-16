import { spawn } from 'node:child_process';
import { rename, stat } from 'node:fs/promises';
import { logger } from '../logger.ts';
import { resolveFfmpeg } from '../util/ffmpeg-resolver.ts';

const TIMEOUT_MS = 30_000;

export const normalizeLoudness = async (filePath: string): Promise<void> => {
  const tmpPath = `${filePath}.tmp.mp3`;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      resolveFfmpeg(),
      ['-y', '-i', filePath, '-filter:a', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'libmp3lame', '-q:a', '4', tmpPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg_loudnorm_timeout'));
    }, TIMEOUT_MS);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`));
    });
  });
  await rename(tmpPath, filePath);
  const after = await stat(filePath);
  logger.info('audio_normalized', { file: filePath, bytes: after.size });
};
