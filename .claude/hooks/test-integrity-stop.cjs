#!/usr/bin/env node
/**
 * Stop — test-integrity gate.
 * If MKTAgent/src has uncommitted changes, the code must still compile before the
 * turn may end. Blocks the stop (feeding the reason back to the model) when
 * `tsc --noEmit` fails, so broken/uncompiled work can't be silently accepted as done.
 * No-op when MKTAgent/src is clean or typecheck passes → cheap on conversational turns.
 */
'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = process.cwd();
const MKT = path.join(ROOT, 'MKTAgent');

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

// Drain stdin (Stop payload) then decide; most logic ignores it.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let dirty = '';
  try {
    dirty =
      sh('git diff --name-only -- MKTAgent/src', { cwd: ROOT }) +
      sh('git diff --cached --name-only -- MKTAgent/src', { cwd: ROOT });
  } catch {
    return allow(); // not a git repo / git unavailable → don't block
  }
  if (!dirty.trim()) return allow(); // no source work in flight

  try {
    sh('npx tsc --noEmit', { cwd: MKT, timeout: 120000 });
    return allow(); // compiles → fine to stop
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    const tail = out.split('\n').slice(-15).join('\n');
    return block(
      'Test-integrity: MKTAgent/src has uncommitted changes and `tsc --noEmit` is FAILING. ' +
        'Fix the compile errors before finishing — do not leave broken code.\n\n' +
        tail
    );
  }
});

function allow() {
  process.stdout.write('{}');
  process.exit(0);
}
function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}
