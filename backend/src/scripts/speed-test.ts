import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { parseArgs, runSpeedTest } from './speed-test-runner.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runSpeedTest(args);
}

main().catch((err) => {
  process.stderr.write(`\nspeed-test failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
