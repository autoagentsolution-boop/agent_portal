#!/usr/bin/env node
/**
 * PostToolUse/Bash — feature ledger on commit.
 * After a `git commit`, append the new commit (hash, subject, changed files) to
 * docs/feature-map.md and remind the model to record the feature's REAL
 * relationships to existing parts of the app. Deduped by hash so a re-fire or a
 * commit-less command never double-writes.
 */
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const DOC = path.join(ROOT, 'docs', 'feature-map.md');

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    const input = JSON.parse(raw || '{}');
    cmd = String(input.tool_input?.command ?? '');
  } catch {
    return quiet();
  }
  if (!/\bgit\b.*\bcommit\b/.test(cmd)) return quiet(); // not a commit

  let hash, subject, files;
  try {
    hash = sh('git rev-parse --short HEAD');
    subject = sh('git log -1 --format=%s');
    files = sh('git show -1 --name-only --format=');
  } catch {
    return quiet(); // commit likely failed / no HEAD
  }
  if (!hash) return quiet();

  // Self-reference guard: a commit whose ONLY changed file is the ledger itself must not be
  // logged. Otherwise the hook records its own bookkeeping and dirties the tree again, so
  // committing that stub produces another stub — an unbounded loop with no natural stop
  // (observed 2026-07-18: three commits chased it before it was diagnosed).
  //
  // Deliberately narrow: `every` (not `some`), so a real commit that happens to touch
  // feature-map.md alongside code is still logged. Only the pure-ledger commit is skipped.
  const changed = files ? files.split('\n').filter(Boolean) : [];
  const LEDGER_REL = 'docs/feature-map.md';
  if (changed.length > 0 && changed.every((f) => f.replace(/\\/g, '/') === LEDGER_REL)) return quiet();

  // Dedup: skip if this hash is already the newest ledger entry.
  let existing = '';
  try {
    existing = fs.readFileSync(DOC, 'utf8');
  } catch {
    existing = '';
  }
  if (existing.includes(`(${hash})`)) return quiet();

  if (!existing) {
    fs.mkdirSync(path.dirname(DOC), { recursive: true });
    fs.writeFileSync(
      DOC,
      '# Feature Map\n\n' +
        'Living record of features shipped and their real relationships in the app. ' +
        'Each commit appends a stub below; the model curates the relationships.\n\n' +
        '## Commit ledger\n\n'
    );
    existing = fs.readFileSync(DOC, 'utf8');
  }

  const fileList = files
    ? files.split('\n').filter(Boolean).map((f) => `  - \`${f}\``).join('\n')
    : '  - (no files)';
  const entry = `- **${subject}** (${hash})\n${fileList}\n`;
  fs.appendFileSync(DOC, entry);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `Commit ${hash} logged to docs/feature-map.md. If this commit adds or changes a ` +
          `user-facing feature, update feature-map.md: describe the feature and its REAL ` +
          `relationships to existing features/modules (what it depends on, what now depends ` +
          `on it, which flows it touches). Skip if it is a pure refactor/chore/docs commit.`,
      },
    })
  );
  process.exit(0);
});

function quiet() {
  process.stdout.write('{}');
  process.exit(0);
}
