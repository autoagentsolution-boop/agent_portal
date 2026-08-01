// Drift-guard (Phase 1.4): the FE credit anchor MUST stay in lock-step with the backend. There is
// no shared module across the API/web split — the values are hand-mirrored with a "keep in sync"
// comment, which historically drifts. This test reads the BACKEND source of truth directly and
// fails the build the moment the two diverge, converting a silent presentation bug into red CI.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOKENS_PER_CREDIT, USD_PER_CREDIT } from './credits.ts';

// Anchor to THIS file, not process.cwd() — so the guard holds regardless of where vitest is invoked
// from (repo root, MKTAgent/, or a monorepo runner). credits.ts is at MKTAgent/src/cost/credits.ts;
// this test is at MKTAgent/web/src/lib/ → up three to MKTAgent, then into src/cost.
const HERE = dirname(fileURLToPath(import.meta.url));
const BE_CREDITS = resolve(HERE, '../../../src/cost/credits.ts');

function backendConst(name: string): number {
  const src = readFileSync(BE_CREDITS, 'utf8');
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([0-9]+)`));
  if (!m) throw new Error(`backend ${name} not found — did src/cost/credits.ts move?`);
  return Number(m[1]);
}

describe('credit anchor mirror (FE ↔ BE)', () => {
  it('TOKENS_PER_CREDIT matches backend src/cost/credits.ts', () => {
    expect(TOKENS_PER_CREDIT).toBe(backendConst('TOKENS_PER_CREDIT'));
  });

  it('USD_PER_CREDIT derives from the same anchor and flash rate ($2.5/M)', () => {
    expect(USD_PER_CREDIT).toBeCloseTo((backendConst('TOKENS_PER_CREDIT') / 1_000_000) * 2.5, 12);
  });
});
