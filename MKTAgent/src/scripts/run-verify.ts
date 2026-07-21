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

// The http tier runs against a server booted WITHOUT a Gemini key, and its scripts are spawned with
// the same env so they can tell.
//
// Why: POST /orchestration/runs routes every message through the Atria brain, a live model
// function-calling loop that decides plan-vs-converse. That judgement is not stable — the same
// message planned on one run and answered on the next — so three http scripts failed
// intermittently, and each run spent real money doing it. With no key the brain falls back to the
// deterministic planner (atria-brain.ts `legacyFallback`), which is what these scripts were written
// against: same assertions, reproducible, free.
//
// Cost: the sections that genuinely need a live model (verify-api's DAG execution) skip themselves
// and say so, rather than passing hollow. Run them by hand against a keyed server.
const DETERMINISTIC_ENV: Record<string, string> = { GEMINI_API_KEY: '' };

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

interface Result { rel: string; tier: Tier; ok: boolean; ms: number; code: number | null; tail: string; skips: string[] }

const run = (s: Script): Promise<Result> =>
  new Promise((resolve) => {
    const started = Date.now();
    // Single command string rather than (cmd, args[]) with shell:true — the array form under a
    // shell concatenates unescaped args (node DEP0190). Paths are repo-internal, and quoting the
    // path keeps Windows' spaces (…/Desktop/Claude/AgentPortal/…) intact.
    const child = spawn(`npx tsx "${s.abs}"`, { cwd: join(SRC_ROOT, '..'), shell: true, env: { ...process.env, ...(s.tier === 'http' ? DETERMINISTIC_ENV : {}) } });
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
        // A PASSING script's output is never printed, so a section that skipped itself would be
        // invisible — the suite would read as full coverage while silently testing less. Lift the
        // skip lines out so they reach the summary.
        skips: lines.filter((l) => /^\s*SKIP\b/.test(l)).map((l) => l.trim()),
      });
    };
    child.on('close', finish);
    child.on('error', (e) => { out += `\n[runner] spawn failed: ${e.message}`; finish(-1); });
  });

// ── HTTP tier server lifecycle ───────────────────────────────────────────────────────────────
// The 14 http-tier scripts need a live server. Booting it here (rather than leaving them to be run
// by hand) is what gives that 17% of the suite an automated path at all.
//
// Reuses an ALREADY-RUNNING server if /health answers, and in that case does not stop it on the way
// out — killing a server the developer started themselves would be a nasty surprise.
const PORT = Number(process.env.PORT ?? 7100);
const HEALTH = `http://localhost:${PORT}/health`;
const BOOT_TIMEOUT_MS = 60_000;

const healthOk = async (): Promise<boolean> => {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch { return false; }
};

interface ServerHandle { stop: () => void; borrowed: boolean }

const startServer = async (): Promise<ServerHandle> => {
  if (await healthOk()) {
    console.log(`server: reusing the one already listening on :${PORT} (will leave it running)`);
    // A borrowed server was started by the developer and probably HAS a Gemini key, which puts the
    // Atria brain back in the loop and makes plan-vs-converse nondeterministic again. Say so — a
    // silent reuse is how "it passes for me" happens. Killing their server would be worse.
    console.log('server: NOTE — a borrowed server may hold a GEMINI_API_KEY; the http tier is only');
    console.log('        deterministic against a server this runner booted. Stop yours to be sure.\n');
    return { stop: () => {}, borrowed: true };
  }
  console.log(`server: booting on :${PORT} …`);
  // `npm start` (tsx src/server.ts), not `dev` — the watcher would hold the process open and
  // restart mid-suite on any file touch. detached so the whole process group can be killed:
  // tsx spawns a child, and killing only the shell leaves the real listener holding the port.
  const child = spawn('npm start', { cwd: join(SRC_ROOT, '..'), shell: true, detached: true, env: { ...process.env, ...DETERMINISTIC_ENV } });
  let log = '';
  child.stdout?.on('data', (b: Buffer) => { log += b.toString(); });
  child.stderr?.on('data', (b: Buffer) => { log += b.toString(); });

  const stop = (): void => {
    try { process.platform === 'win32' ? spawn(`taskkill /pid ${child.pid} /T /F`, { shell: true }) : process.kill(-child.pid!); }
    catch { /* already gone */ }
  };

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      console.error(`server: exited early (code ${child.exitCode}). Output:\n${log.slice(-1500)}`);
      throw new Error('server failed to start');
    }
    if (await healthOk()) {
      console.log(`server: healthy after ${((BOOT_TIMEOUT_MS - (deadline - Date.now())) / 1000).toFixed(1)}s\n`);
      return { stop, borrowed: false };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  console.error(`server: /health never answered within ${BOOT_TIMEOUT_MS}ms. Output:\n${log.slice(-1500)}`);
  throw new Error('server boot timed out');
};

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

  // Boot only when an http-tier script is actually queued, and always tear down — a suite that
  // leaves a stray server holding :7100 poisons the next run.
  const server = queue.some((s) => s.tier === 'http') ? await startServer() : null;

  const results: Result[] = [];
  try {
    for (const [i, s] of queue.entries()) {
      process.stdout.write(`[${String(i + 1).padStart(2)}/${queue.length}] ${s.rel} … `);
      const r = await run(s);
      results.push(r);
      console.log(r.ok ? `ok (${(r.ms / 1000).toFixed(1)}s)` : `FAIL (exit ${r.code})`);
    }
  } finally {
    if (server && !server.borrowed) { server.stop(); console.log('\nserver: stopped'); }
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
  const withSkips = results.filter((r) => r.skips.length);
  if (withSkips.length) {
    console.log(`\nSections skipped inside passing scripts (NOT covered by this run):`);
    for (const r of withSkips) for (const s of r.skips) console.log(`  ${r.rel}: ${s.replace(/^SKIP\s*/, '')}`);
  }
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('verify runner crashed:', e);
  process.exit(1);
});
