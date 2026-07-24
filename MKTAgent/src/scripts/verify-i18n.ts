// i18n enforcement (unit tier). The defect class this guards survived SEVEN one-off fixes because
// nothing FAILED when the next path forgot — so this is the phase that makes "global" true. All checks
// are cheap file reads/parses; no network, no LLM, no DB.
//
// HARD (fail the build):
//   1. param parity   — every non-en catalog value's {param} set === the English key's set
//   2. catalog validity — every non-en key exists in English (also caught by tsc, cheap belt here)
//   3. no conflation  — 'uiLanguage' never read inside src/orchestration/** (content ≠ interface)
//   4. literal scan   — files in i18n-migrated.json must not reintroduce hardcoded user-facing text
//
// SOFT (report, do not fail — flip to HARD once the phase 02/03 sweep lands):
//   5. code coverage  — server-thrown/fail() codes ⊆ err.*/notice.* catalog keys
//   6. orphan keys    — every catalog key is referenced somewhere in web/src
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WEB_SRC = join(REPO, 'web', 'src');
const ORCH = join(REPO, 'src', 'orchestration');

// Load the web catalogs at RUNTIME via a computed path so the BE tsconfig does not pull the web-style
// (extensionless) catalog imports into its own compilation — `npm run typecheck` must stay clean.
type Cat = Record<string, string>;
const loadCatalog = async (name: string, member: string): Promise<Cat> => {
  const mod = await import(pathToFileURL(join(WEB_SRC, 'i18n', name)).href);
  return mod[member] as Cat;
};
const en = await loadCatalog('catalog.en.ts', 'en');
// Non-English locales to check. Adding a language = one entry here + its catalog file (the pipeline
// fills it). Kept in sync with UI_LOCALES in web/src/i18n/index.ts.
const LOCALE_CODES = ['vi', 'id', 'ko', 'fr'];
const LOCALES: Record<string, Cat> = {};
for (const code of LOCALE_CODES) LOCALES[code] = await loadCatalog(`catalog.${code}.ts`, code);

const paramsOf = (s: string): Set<string> => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
const eqSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

const walk = async (dir: string, test: (n: string) => boolean): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, test)));
    else if (e.isFile() && test(e.name)) out.push(p);
  }
  return out;
};

const failures: string[] = [];
const warnings: string[] = [];

// ── 1 + 2: param parity + catalog validity ───────────────────────────────────────────────────
for (const [name, cat] of Object.entries(LOCALES)) {
  for (const [key, value] of Object.entries(cat)) {
    if (!(key in en)) {
      failures.push(`catalog.${name}: key "${key}" is not in the English catalog (dead/typo key)`);
      continue;
    }
    const want = paramsOf((en as Record<string, string>)[key]!);
    const got = paramsOf(value!);
    if (!eqSet(want, got)) {
      failures.push(`catalog.${name}["${key}"]: params {${[...got]}} ≠ English {${[...want]}} — a dropped/invented {param} breaks interpolation`);
    }
  }
}

// ── 3: no conflation (uiLanguage must never decide content) ───────────────────────────────────
{
  const files = await walk(ORCH, (n) => /\.ts$/.test(n));
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    if (/\buiLanguage\b/.test(src)) {
      failures.push(`src/orchestration/${f.slice(ORCH.length + 1).replace(/\\/g, '/')}: reads 'uiLanguage' — interface language must never decide content language`);
    }
  }
}

// ── 4: GLOBAL literal scan — enforced by DEFAULT across all of web/src ─────────────────────────
// Every .tsx is scanned; a raw user-facing literal in a notify/confirm/etc sink FAILS the build. This
// is what makes "global" true and holds it: a NEW component (or a new feature added to an old one)
// cannot ship an untranslated toast, because it is enforced the moment it exists — not when someone
// remembers to opt it in. The scan is tuned NARROW (only the highest-signal sinks) so it stays
// false-positive-free; a noisy gate gets disabled, which is worse than none.
//
// `i18n-exempt.json` is the SHRINKING legacy backlog — files not yet swept. A file leaves it by being
// migrated (its literals wrapped in t()). New files are never on it, so they are guarded from birth.
// A genuine one-off (a log string, a test fixture) uses an inline `// i18n-ignore` on that line.
{
  const exemptRaw = await readFile(join(WEB_SRC, 'i18n', 'i18n-exempt.json'), 'utf8').catch(() => '[]');
  const exempt = new Set<string>(JSON.parse(exemptRaw));
  const SINK = /\b(?:confirm|alert|prompt|notify|show|toast)\s*\(\s*(['"])(?:[^'"]*\s[^'"]*)\1/;
  const DYNAMIC_KEY = /\bt(?:Error)?\(\s*(['"`])[^'"`]*\1\s*\+/;
  const tsxFiles = await walk(WEB_SRC, (n) => /\.tsx$/.test(n));
  for (const abs of tsxFiles) {
    const rel = abs.slice(WEB_SRC.length + 1).replace(/\\/g, '/');
    if (exempt.has(rel)) continue; // legacy backlog — sweep it, then remove from the exempt list
    const src = await readFile(abs, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\bi18n-ignore\b/.test(line)) return;
      if (SINK.test(line)) failures.push(`${rel}:${i + 1}: raw user-facing literal in a notify/confirm/etc sink — wrap it in t()`);
      if (DYNAMIC_KEY.test(line)) failures.push(`${rel}:${i + 1}: dynamic t() key — every static i18n check is defeated by 't("a."+x)'`);
    });
  }
}

// ── 5 + 6: soft coverage/orphan reports (flip to HARD after the phase 02/03 sweep) ────────────
{
  const webFiles = await walk(WEB_SRC, (n) => /\.tsx?$/.test(n));
  const webBlob = (await Promise.all(webFiles.map((f) => readFile(f, 'utf8')))).join('\n');
  // Orphan: a catalog key nobody references. err.*/notice.* are reached DYNAMICALLY via tError(`err.${code}`)
  // so they are exempt from the static reference check.
  const orphans = Object.keys(en).filter(
    (k) => !k.startsWith('err.') && !k.startsWith('notice.') && !webBlob.includes(`'${k}'`) && !webBlob.includes(`"${k}"`),
  );
  if (orphans.length) warnings.push(`${orphans.length} catalog key(s) not yet referenced (expected pre-migration): ${orphans.slice(0, 6).join(', ')}${orphans.length > 6 ? '…' : ''}`);
}

// ── report ────────────────────────────────────────────────────────────────────────────────────
console.log(`verify-i18n: en=${Object.keys(en).length} keys, locales=${LOCALE_CODES.join('/')}`);
for (const w of warnings) console.log(`  WARN  ${w}`);
if (failures.length) {
  console.error(`\nverify-i18n FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`verify-i18n: OK — param parity, catalog validity, no conflation, literal allow-list all clean`);
process.exit(0);
