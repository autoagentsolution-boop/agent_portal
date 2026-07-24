// Build-time catalog generator (i18n phase 04). Fills the MISSING keys of a locale catalog from the
// English source, via the same Gemini plumbing the app already uses — NEVER at runtime (that would bill
// per pageview). Human edits are sacred: only absent keys are generated, existing values are untouched.
//
// Catalogs are JSON (catalog.<code>.json); English is the typed .ts source (catalog.en.ts). The locale
// set + English language names come from web/src/i18n/locales.ts (the single source), so adding a
// language is one row there + one run of this script.
//
// Risk split: ACT-ON keys (money/irreversible/connect) are recorded to catalog.<code>.review.json for a
// human pass. By default they are ALSO withheld from the shipped catalog; pass --ship-act-on to promote
// them (used for a bulk launch — generated strings ship, flagged for later native review).
//
//   npx tsx src/scripts/i18n-translate.ts --locale ja
//   npx tsx src/scripts/i18n-translate.ts --locale ja --ship-act-on
//   npx tsx src/scripts/i18n-translate.ts --locale ja --dry
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { env } from '../config/env.ts';
import { callGeminiJson } from '../orchestration/master/llm-json.ts';
import { recordLlmUsage } from '../cost/llm-usage.ts';
import type { GeminiUsage } from '../orchestration/executor/node-cost.ts';

const REPO = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const I18N_DIR = join(REPO, 'web', 'src', 'i18n');
const BATCH = 40;

const ACT_ON = /^(approve\.|credits\.|connect\.|reconnect\.|confirm\.|schedule\.|publish\.|err\.|notice\.|autonomy\.grant|video\.approve|gate\.external|flow\.abort|plan\.tier)/;

const paramsOf = (s: string): Set<string> => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
const eqSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
const unsafe = (s: string): boolean => /<\/script/i.test(s);

const importTs = async (name: string, member: string): Promise<Record<string, string>> =>
  (await import(pathToFileURL(join(I18N_DIR, name)).href))[member];
const readJson = async (file: string): Promise<Record<string, string>> =>
  JSON.parse(await readFile(join(I18N_DIR, file), 'utf8').catch(() => '{}'));
const writeJson = (file: string, obj: Record<string, string>): Promise<void> => {
  const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]!]));
  return writeFile(join(I18N_DIR, file), JSON.stringify(sorted, null, 2) + '\n', 'utf8');
};

const translateBatch = async (name: string, batch: Array<[string, string]>): Promise<Record<string, string>> => {
  const system =
    `You are a professional UI localizer. Translate app interface strings into ${name}. ` +
    `Return ONLY a JSON object mapping each given key to its translation. Preserve every {token} EXACTLY ` +
    `(same names, do not translate them). Keep it natural and concise for a software UI. Keep leading ` +
    `emoji/symbols. Do not add keys.`;
  const user = JSON.stringify(Object.fromEntries(batch.map(([k, v]) => [k, v])));
  let usage: GeminiUsage | null = null;
  const out = (await callGeminiJson(system, user, (u) => { usage = u; })) as Record<string, string>;
  if (usage) await recordLlmUsage({ ownerId: null, surface: 'i18n', model: env.GEMINI_MODEL, usage });
  return out;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const locale = argv[argv.indexOf('--locale') + 1];
  const dry = argv.includes('--dry');
  const shipActOn = argv.includes('--ship-act-on');

  const { LOCALE_DEFS } = await import(pathToFileURL(join(I18N_DIR, 'locales.ts')).href) as { LOCALE_DEFS: Array<{ code: string; name: string }> };
  const def = LOCALE_DEFS.find((l) => l.code === locale);
  if (!locale || !def || locale === 'en') {
    console.error(`usage: --locale <${LOCALE_DEFS.filter((l) => l.code !== 'en').map((l) => l.code).join('|')}> [--ship-act-on] [--dry]`);
    process.exit(2);
  }
  if (!env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not configured — this build-time generator needs a key.'); process.exit(2); }

  const en = await importTs('catalog.en.ts', 'en');
  const existing = await readJson(`catalog.${locale}.json`);
  const missing = Object.keys(en).filter((k) => !(k in existing));
  console.log(`i18n-translate ${locale} (${def.name}): ${Object.keys(en).length} en, ${Object.keys(existing).length} done, ${missing.length} missing`);
  if (missing.length === 0) { console.log('nothing to generate.'); process.exit(0); }
  if (dry) { console.log('missing:', missing.slice(0, 20).join(', '), missing.length > 20 ? '…' : ''); process.exit(0); }

  const generated: Record<string, string> = {};
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH).map((k) => [k, en[k]!] as [string, string]);
    const out = await translateBatch(def.name, batch);
    for (const [k, srcText] of batch) {
      const got = out[k];
      if (typeof got !== 'string' || !got.trim()) throw new Error(`missing translation for "${k}"`);
      if (unsafe(got)) throw new Error(`unsafe characters in translation for "${k}": ${got}`);
      if (!eqSet(paramsOf(srcText), paramsOf(got))) {
        throw new Error(`param mismatch for "${k}": en{${[...paramsOf(srcText)]}} vs ${locale}{${[...paramsOf(got)]}}`);
      }
      generated[k] = got;
    }
    console.log(`  batch ${i / BATCH + 1}: +${batch.length}`);
  }

  const reviewKeys = Object.keys(generated).filter((k) => ACT_ON.test(k));
  const shipped = { ...existing, ...(shipActOn ? generated : Object.fromEntries(Object.entries(generated).filter(([k]) => !ACT_ON.test(k)))) };
  await writeJson(`catalog.${locale}.json`, shipped);
  console.log(`  wrote ${Object.keys(shipped).length - Object.keys(existing).length} key(s) → catalog.${locale}.json${shipActOn ? ' (incl. act-on)' : ''}`);
  if (reviewKeys.length) {
    await writeJson(`catalog.${locale}.review.json`, Object.fromEntries(reviewKeys.map((k) => [k, generated[k]!])));
    console.log(`  recorded ${reviewKeys.length} act-on key(s) → catalog.${locale}.review.json (needs a native pass)`);
  }
  process.exit(0);
};

main().catch((e) => { console.error('i18n-translate failed:', e instanceof Error ? e.message : e); process.exit(1); });
