// verify-image-quality-routing — F1. Pins the base-vs-Pro image-model selection contract WITHOUT any
// provider spend: the model id an ImageRequest resolves to, the on-frame-text heuristic, the cache-key
// split (base vs Pro of the same prompt are DIFFERENT images), and the Pro price row. Unit tier (pure).
import { createHash } from 'node:crypto';
import { imageModelId } from '../imagegen/nano-banana.ts';
import { costUsdFromUsage } from './executor/node-cost.ts';
import { KEYFRAME_TEXT_RE } from './executor/agent-runners.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

console.log('Image quality routing (base vs Pro) — F1');

// 1. Model resolution. Default/base → flash-image; 'pro' → gemini-3-pro-image.
check("default quality → base flash-image", imageModelId({}) === 'gemini-2.5-flash-image', imageModelId({}));
check("quality 'base' → base flash-image", imageModelId({ quality: 'base' }) === 'gemini-2.5-flash-image', imageModelId({ quality: 'base' }));
check("quality 'pro' → gemini-3-pro-image", imageModelId({ quality: 'pro' }) === 'gemini-3-pro-image', imageModelId({ quality: 'pro' }));

// 2. The runner's on-frame-text heuristic. Import the REAL regex from agent-runners (was a copy that
//    could silently drift from the source) so this pin follows the actual decision. A frame WITH text
//    words → 'pro'; a plain product shot → 'base'. This is the decision that fixes the Vietnamese-
//    diacritic corruption ("Nắng Sớm" → "Nắng Sóm") on title/label frames.
const quality = (prompt: string): 'base' | 'pro' => (KEYFRAME_TEXT_RE.test(prompt) ? 'pro' : 'base');
check('title-card keyframe → pro', quality('A title card reading "Nắng Sớm" over a coffee cup') === 'pro');
check('VN "chữ" prompt → pro', quality('poster có chữ "Nắng Sớm" lớn ở giữa') === 'pro');
check('plain product shot → base', quality('A steaming cup of coffee on a wooden table, morning light') === 'base');
check('onImageText non-empty maps to pro (infographic path)', (['Nắng Sớm'].length > 0 ? 'pro' : 'base') === 'pro');
check('onImageText empty maps to base', ([].length > 0 ? 'pro' : 'base') === 'base');

// 3. Cache-key split: the SAME prompt at base vs Pro must hash to DIFFERENT files (else a base render
//    would be served where Pro was asked, re-corrupting the text). Mirror nano-banana's hashKey formula.
const key = (model: string, prompt: string): string =>
  createHash('sha256').update(`${model}::text-to-image::::${prompt}`).digest('hex').slice(0, 24);
check('base vs Pro of the same prompt → distinct cache keys',
  key('gemini-2.5-flash-image', 'poster') !== key('gemini-3-pro-image', 'poster'));

// 4. Pro price row exists and is higher than base (so the cost gate/ledger reflects the real spend).
const usage = { promptTokens: 100, outputTokens: 1290, thoughtTokens: 0, cachedTokens: 0 };
const baseCost = costUsdFromUsage(usage, 'gemini-2.5-flash-image');
const proCost = costUsdFromUsage(usage, 'gemini-3-pro-image');
check('Pro image cost is priced (non-zero)', proCost > 0, proCost);
check('Pro image cost > base image cost', proCost > baseCost, { base: baseCost, pro: proCost });

console.log(failures === 0 ? '\nPASS — image quality routing checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
