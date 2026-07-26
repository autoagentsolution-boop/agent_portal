// Platform-asset drift guard (unit tier). The FE per-platform asset picker constrains what a user
// can attach (web/src/components/form-options.ts `platformAssetSupport`) and its comment says
// "keep in lock-step with src/social/*.ts adapters." The adapters' `supports[]` is the RUNTIME
// truth (via postability.ts). A comment enforces nothing — if an adapter gains video but the FE
// table doesn't, the picker silently hides a now-valid option (or worse, offers one the adapter
// will reject). This asserts the two agree so that drift is a build failure.
//
// Axis note: adapters also list 'text' in supports[] (a text-only post has no asset). The FE picker
// is about ATTACHABLE MEDIA, so it never offers 'text'. We compare on the media asset types only
// {image, carousel, video}; 'text' is excluded on both sides.
import { supportedAssetTypes } from '../social/postability.ts';
import { readFile } from 'node:fs/promises';
import { SocialPlatform } from '../../prisma/generated/prisma/enums.ts';
import type { AssetType } from '../../prisma/generated/prisma/client.ts';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FE_FILE = `${ROOT}/web/src/components/form-options.ts`;

const MEDIA: AssetType[] = ['image', 'carousel', 'video'];
// Derive the platform set from the Prisma enum, NOT a hardcoded literal — a 6th platform added to
// the schema + an adapter would otherwise be silently skipped here (the guard's own blind spot).
// Deriving forces every enum member through the BE↔FE check.
const PLATFORMS = Object.values(SocialPlatform);

// Parse the FE `platformAssetSupport` object literal from source (the FE module imports a browser
// `Dto` type we can't load under tsx, so read+parse rather than import). Extract each platform's
// bracketed array and its quoted asset strings.
const parseFeTable = (src: string): Record<string, string[]> => {
  const block = src.match(/platformAssetSupport[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('platformAssetSupport literal not found in form-options.ts');
  const table: Record<string, string[]> = {};
  const rowRe = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block[1] ?? ''))) {
    const [, key, body] = m;
    if (!key) continue;
    table[key] = [...(body ?? '').matchAll(/'([^']+)'/g)].map((t) => t[1] ?? '');
  }
  return table;
};

const feTable = parseFeTable(await readFile(FE_FILE, 'utf8'));

const failures: string[] = [];
const setEq = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

for (const p of PLATFORMS) {
  const beMedia = supportedAssetTypes(p).filter((t) => MEDIA.includes(t)).map(String);
  const fe = (feTable[p] ?? []).filter((t) => (MEDIA as string[]).includes(t));
  if (feTable[p] === undefined) { failures.push(`${p}: missing from FE platformAssetSupport`); console.log(`  FAIL ${p} — absent in FE`); continue; }
  if (setEq(beMedia, fe)) console.log(`  ok   ${p}: [${fe.join(', ')}]`);
  else { failures.push(`${p} DRIFT — BE adapter: [${beMedia.join(', ')}] vs FE picker: [${fe.join(', ')}]`); console.log(`  FAIL ${p}: BE=[${beMedia}] FE=[${fe}]`); }
}

// Guard against a platform the FE lists but BE has no adapter for (reverse drift).
for (const p of Object.keys(feTable)) {
  if (!PLATFORMS.includes(p as SocialPlatform)) failures.push(`${p}: in FE picker but not a known adapter platform`);
}

if (failures.length) {
  console.log(`\nFAIL — platform-asset drift between adapters and FE picker:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`);
  console.log('\n  Fix: sync web/src/components/form-options.ts platformAssetSupport with the adapter supports[] in src/social/*.ts.');
  process.exit(1);
}
console.log('\nPASS — FE asset picker matches adapter supports[] for every platform');
process.exit(0);
