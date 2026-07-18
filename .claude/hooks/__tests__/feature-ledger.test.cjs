#!/usr/bin/env node
/**
 * Tests for feature-ledger.cjs — the self-reference guard.
 * Run: node --test .claude/hooks/__tests__/feature-ledger.test.cjs
 *
 * The hook appends a stub to docs/feature-map.md after every `git commit`. Without a guard it
 * also logs commits that ONLY touch that file, so committing the stub dirties the tree again and
 * produces another stub — an unbounded loop (observed 2026-07-18).
 *
 * Each test drives the real hook against a throwaway git repo, so the assertions exercise the
 * actual `git show --name-only` path rather than a mocked one.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK_PATH = path.join(__dirname, '..', 'feature-ledger.cjs');
const LEDGER = path.join('docs', 'feature-map.md');

function runHook(cwd, command = 'git commit -m x') {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [HOOK_PATH], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
    proc.stdin.write(JSON.stringify({ tool_input: { command } }));
    proc.stdin.end();
  });
}

const git = (cwd, cmd) => execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('feature-ledger self-reference guard', () => {
  let repo;

  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-ledger-'));
    git(repo, 'init -q');
    git(repo, 'config user.email test@test.local');
    git(repo, 'config user.name Test');
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, LEDGER), '# Feature Map\n\n## Commit ledger\n\n');
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
    git(repo, 'add -A');
    git(repo, 'commit -q -m "seed"');
  });

  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ledgerText = () => fs.readFileSync(path.join(repo, LEDGER), 'utf8');

  it('does NOT log a commit whose only changed file is the ledger', async () => {
    fs.appendFileSync(path.join(repo, LEDGER), '- **prior stub** (deadbee)\n');
    git(repo, 'add -A');
    git(repo, 'commit -q -m "chore(feature-map): commit ledger stub"');
    const before = ledgerText();

    const res = await runHook(repo);

    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(ledgerText(), before, 'ledger must be unchanged — this is the loop guard');
    assert.strictEqual(res.stdout.trim(), '{}', 'must stay quiet, emitting no reminder');
  });

  it('DOES log a commit that touches code', async () => {
    fs.writeFileSync(path.join(repo, 'feature.ts'), 'export const x = 1;\n');
    git(repo, 'add -A');
    git(repo, 'commit -q -m "feat: a real feature"');

    const res = await runHook(repo);
    const hash = git(repo, 'rev-parse --short HEAD').trim();

    assert.ok(ledgerText().includes(`(${hash})`), 'a real commit must still be logged');
    assert.ok(ledgerText().includes('feat: a real feature'));
    assert.ok(res.stdout.includes('feature-map.md'), 'must emit the curation reminder');
  });

  it('DOES log a commit touching the ledger ALONGSIDE code (guard is narrow)', async () => {
    fs.writeFileSync(path.join(repo, 'other.ts'), 'export const y = 2;\n');
    fs.appendFileSync(path.join(repo, LEDGER), '- **hand-written relationship note**\n');
    git(repo, 'add -A');
    git(repo, 'commit -q -m "feat: code plus a curated note"');

    await runHook(repo);
    const hash = git(repo, 'rev-parse --short HEAD').trim();

    assert.ok(
      ledgerText().includes(`(${hash})`),
      'the guard must use every(), not some() — a mixed commit is a real commit',
    );
  });

  it('is idempotent — a re-fire on the same hash does not double-write', async () => {
    const before = ledgerText();
    await runHook(repo);
    assert.strictEqual(ledgerText(), before, 'existing dedup-by-hash must still hold');
  });

  it('ignores commands that are not a git commit', async () => {
    const before = ledgerText();
    const res = await runHook(repo, 'git status');
    assert.strictEqual(ledgerText(), before);
    assert.strictEqual(res.stdout.trim(), '{}');
  });
});
