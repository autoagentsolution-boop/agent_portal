// Aggregate runner for the 83 `verify-*.ts` scripts (doc 09 §2.1). Before this, nothing ran them
// together and package.json had no `test` script, so the project's own "run tests before push" rule
// was unenforceable in practice — a subset got run, chosen by whoever remembered which mattered.
//
// Every verify script already self-reports and sets a non-zero exit code on failure (checked: 83/83
// call process.exit/exitCode), so this only has to sequence them and aggregate.
//
// SEQUENTIAL BY DESIGN — not a performance oversight. Most db-tier scripts create and then delete a
// throwaway tenant, and several assert on global row counts; running them concurrently against one
// database makes them race and flake. Correctness beats wall-clock here.
//
// Usage:
//   npx tsx src/scripts/run-verify.ts            # unit + db (the default gate)
//   npx tsx src/scripts/run-verify.ts --tier unit
//   npx tsx src/scripts/run-verify.ts --tier http   # requires a server on :7100
//   npx tsx src/scripts/run-verify.ts --tier all --include-costly
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SRC_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PER_SCRIPT_TIMEOUT_MS = 180_000;

// Scripts that perform a REAL, billable external call with no key-guard or skip path. Excluded from
// every tier unless --include-costly. Keep this list tiny and evidence-based: add a script only
// after confirming in its source that it spends money unconditionally.
//   • verify-image-live.ts — its own header: "ONE real Nano Banana call (~$0.06)". No guard.
const COSTLY = new Set(['imagegen/verify-image-live.ts']);

// Scripts whose tier the source-scan gets wrong because they reach the DB TRANSITIVELY — the file
// itself never names prisma, but code it exercises does. Static scanning cannot see through the
// import graph, so these are corrected by hand. Only matters when running a single tier; the
// default gate runs unit+db together either way.
//   • verify-email-node.ts → runEmailAgent → isEmailSuppressed → prisma (nurture-thread-repo.ts)
const TIER_OVERRIDE: Record<string, Tier> = { 'orchestration/verify-email-node.ts': 'db' };

type Tier = 'unit' | 'db' | 'http';
interface Script { rel: string; abs: string; tier: Tier }

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && /^verify-.*\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};

// Tier is derived from what the script actually touches, so adding a new verify script needs no
// registration here. http wins over db: the HTTP ones also use prisma for fixture setup.
const classify = (source: string): Tier => {
  // Match the HOST, not a hard-coded port: several scripts build the base as
  // `http://localhost:${env.PORT}`, which an exact `localhost:7100` pattern silently misses —
  // they then land in the db tier and fail with ECONNREFUSED instead of being tiered out.
  if (/localhost:|127\.0\.0\.1:|Server not reachable/.test(source)) return 'http';
  if (/\bprisma\b/.test(source)) return 'db';
  return 'unit';
};

const discover = async (): Promise<Script[]> => {
  const files = await walk(SRC_ROOT);
  const scripts = await Promise.all(
    files.map(async (abs) => {
      const rel = relative(SRC_ROOT, abs).replace(/\\/g, '/');
      return { rel, abs, tier: TIER_OVERRIDE[rel] ?? classify(await readFile(abs, 'utf8')) };
    }),
  );
  return scripts.sort((a, b) => a.rel.localeCompare(b.rel));
};

interface Result { rel: string; tier: Tier; ok: boolean; ms: number; code: number | null; tail: string }

const run = (s: Script): Promise<Result> =>
  new Promise((resolve) => {
    const started = Date.now();
    // Single command string rather than (cmd, args[]) with shell:true — the array form under a
    // shell concatenates unescaped args (node DEP0190). Paths are repo-internal, and quoting the
    // path keeps Windows' spaces (…/Desktop/Claude/AgentPortal/…) intact.
    const child = spawn(`npx tsx "${s.abs}"`, { cwd: join(SRC_ROOT, '..'), shell: true });
    let out = '';
    const capture = (b: Buffer): void => { out += b.toString(); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const timer = setTimeout(() => {
      child.kill();
      out += `\n[runner] killed after ${PER_SCRIPT_TIMEOUT_MS}ms`;
    }, PER_SCRIPT_TIMEOUT_MS);

    const finish = (code: number | null): void => {
      clearTimeout(timer);
      const lines = out.trimEnd().split('\n');
      resolve({
        rel: s.rel, tier: s.tier, ok: code === 0, ms: Date.now() - started, code,
        tail: lines.slice(-12).join('\n'),
      });
    };
    child.on('close', finish);
    child.on('error', (e) => { out += `\n[runner] spawn failed: ${e.message}`; finish(-1); });
  });

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const tierArg = (argv[argv.indexOf('--tier') + 1] ?? 'default') as Tier | 'all' | 'default';
  const includeCostly = argv.includes('--include-costly');

  const all = await discover();
  const wanted: Tier[] =
    tierArg === 'all' ? ['unit', 'db', 'http']
    : tierArg === 'default' ? ['unit', 'db']
    : [tierArg as Tier];

  const skippedCostly = all.filter((s) => COSTLY.has(s.rel) && !includeCostly);
  const queue = all.filter((s) => wanted.includes(s.tier) && !(COSTLY.has(s.rel) && !includeCostly));

  console.log(`verify runner — ${queue.length} script(s), tier(s): ${wanted.join(', ')}`);
  for (const t of wanted) console.log(`  ${t}: ${queue.filter((s) => s.tier === t).length}`);
  for (const s of skippedCostly) console.log(`  SKIPPED (billable, use --include-costly): ${s.rel}`);
  console.log('');

  const results: Result[] = [];
  for (const [i, s] of queue.entries()) {
    process.stdout.write(`[${String(i + 1).padStart(2)}/${queue.length}] ${s.rel} … `);
    const r = await run(s);
    results.push(r);
    console.log(r.ok ? `ok (${(r.ms / 1000).toFixed(1)}s)` : `FAIL (exit ${r.code})`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(72)}`);
  if (failed.length) {
    for (const f of failed) {
      console.log(`\nFAILED: ${f.rel} (exit ${f.code})`);
      console.log(f.tail.split('\n').map((l) => `  │ ${l}`).join('\n'));
    }
    console.log(`\n${failed.length} of ${results.length} FAILED`);
  } else {
    console.log(`ALL ${results.length} PASSED`);
  }
  if (skippedCostly.length && !includeCostly) {
    console.log(`(${skippedCostly.length} billable script(s) skipped — not covered by this run)`);
  }
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('verify runner crashed:', e);
  process.exit(1);
});
