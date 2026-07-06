// Verify copy-variant parsing incl. the truncation salvage (fix for the live
// "Unterminated string in JSON" concept_writer failure). Pure — no API.
import { parseVariants } from './parse.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const mk = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

// Clean response parses.
const ok = parseVariants(mk(JSON.stringify({ variants: [
  { body: 'first body', threads: 't1', x: 'x1' },
  { body: 'second body', threads: 't2', x: 'x2' },
] })));
ck('valid JSON → 2 variants', ok.ok && ok.variants.length === 2, ok);

// Truncated response (model output cut mid-string) → salvage the complete variants.
const truncated =
  '{"variants":[{"body":"first body","threads":"t1","x":"x1"},{"body":"second body","threads":"t2","x":"x2"},{"body":"third body","threads":"t3","x":"x3"},{"body":"fourth body cut off mid-str';
const sal = parseVariants(mk(truncated));
ck('truncated JSON → salvages 3 complete variants', sal.ok && sal.variants.length === 3, sal.ok ? sal.variants.map((v) => v.body) : sal);
ck('salvaged variants keep their body', sal.ok && sal.variants[0]?.body === 'first body');

// Length safety-net still applies to salvaged variants.
const longX = '{"variants":[{"body":"b","threads":"t","x":"' + 'z'.repeat(400) + '"},{"body":"b2","threads":"t2","x":"cut';
const capd = parseVariants(mk(longX));
ck('salvaged x is capped to 280', capd.ok && (capd.variants[0]?.x.length ?? 0) <= 280, capd.ok ? capd.variants[0]?.x.length : capd);

// Nothing salvageable → faithful error (not a throw).
const garbage = parseVariants(mk('not json at all {["'));
ck('unsalvageable → ok:false error', garbage.ok === false, garbage);

// Upstream Gemini error surfaces faithfully.
const upstream = parseVariants({ error: { code: 429, message: 'rate limited' } });
ck('upstream error surfaced', upstream.ok === false && /429|rate limited/.test(upstream.error), upstream);

console.log(failures ? `\nFAIL — ${failures} variant-parse check(s) red` : '\nPASS — variant parse + truncation salvage green');
process.exit(failures ? 1 : 0);
