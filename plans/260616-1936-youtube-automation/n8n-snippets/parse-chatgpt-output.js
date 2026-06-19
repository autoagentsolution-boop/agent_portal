/**
 * n8n Code node — validate storyboard + metadata against schema/CTA/duration rules.
 *
 * MODE: "Run Once for All Items"
 * INPUT (first item, accepts EITHER shape — checked in order):
 *
 *   A. Pre-parsed (PREFERRED — folder mode, after Read Binary File + Move Binary Data + JSON.parse):
 *      { json: { storyboard: {...}, metadata: {...} } }
 *
 *   B. Raw chat text (webhook mode fallback — user pasted full ChatGPT reply):
 *      { json: { chatgptOutput: "...```json\n...\n```\n```json\n...\n```..." } }
 *
 * OUTPUT (single item):
 *   ok branch:
 *     { json: { ok: true, dishSlug, storyboard, metadata, totalDurationSec, panelCount } }
 *   error branch:
 *     { json: { ok: false, errors: [{ where, message }, ...], rawSnippet? } }
 *
 * Downstream nodes:
 *   - IF node split on `{{ $json.ok }}`
 *   - ok → Execute Command (render-storyboard-v2) → YouTube upload → DB write → Gmail success
 *   - err → Gmail "ChatGPT reply rejected" with errors[] table → stop
 *
 * No external libs required. Pure ES2022.
 */

const CTA_NARRATION_SUFFIX = 'Bấm đăng ký kênh để xem thêm món Việt mỗi tuần!';
const CTA_LABEL_LINE2 = 'ĐĂNG KÝ KÊNH 🔔';
const CTA_DESCRIPTION_MARKER = '👉 Bấm đăng ký kênh';
const VALID_DURATIONS = new Set([4, 6, 8]);
const VALID_TRANSITIONS = new Set(['cut', 'fade', 'zoom', 'swipe']);
const VALID_KINDS = new Set(['intro', 'step', 'outro']);
const VALID_COMPLEXITY = new Set(['simple', 'complex']);
const MIN_PANELS = 9;
const MAX_PANELS = 14;
const MIN_TOTAL_SEC = 45;
const MAX_TOTAL_SEC = 60;
// Vietnamese natural reading pace; Remotion cuts CTA mid-word above this rate.
const VN_WORDS_PER_SEC = 2.5;
// Tier 1 daily cap = 10 Fast videos. Cap "complex" panels per storyboard so a single dish
// can't blow the entire daily Fast bucket on its own.
const MAX_COMPLEX_PANELS = 2;
const SLUG_RE = /^[a-z0-9-]+$/;

const errors = [];
const push = (where, message) => errors.push({ where, message });

const input = $input.first()?.json ?? {};
let storyboard;
let metadata;
let rawSnippet;

if (input.storyboard && input.metadata) {
  // Mode A: pre-parsed (folder mode)
  storyboard = input.storyboard;
  metadata = input.metadata;
} else if (typeof input.chatgptOutput === 'string' && input.chatgptOutput.trim().length > 0) {
  // Mode B: raw chat text (webhook fallback)
  rawSnippet = input.chatgptOutput.slice(0, 500);
  const blocks = extractJsonBlocks(input.chatgptOutput);
  if (blocks.length < 2) {
    return [{ json: {
      ok: false,
      errors: [{ where: 'parse', message: `expected 2 fenced \`\`\`json blocks, found ${blocks.length}` }],
      rawSnippet,
    } }];
  }
  try { storyboard = JSON.parse(blocks[0]); }
  catch (e) { push('storyboard.parse', `JSON.parse failed: ${e.message}`); }
  try { metadata = JSON.parse(blocks[1]); }
  catch (e) { push('metadata.parse', `JSON.parse failed: ${e.message}`); }
} else {
  return [{ json: {
    ok: false,
    errors: [{ where: 'input', message: 'expected either { storyboard, metadata } or { chatgptOutput: string }' }],
  } }];
}

if (storyboard) validateStoryboard(storyboard);
if (metadata) validateMetadata(metadata);

if (errors.length > 0) {
  return [{ json: { ok: false, errors, ...(rawSnippet ? { rawSnippet } : {}) } }];
}

return [{ json: {
  ok: true,
  dishSlug: storyboard.dishSlug,
  storyboard,
  metadata,
  totalDurationSec: storyboard.totalDurationSec,
  panelCount: storyboard.panels.length,
} }];

// ---------- helpers ----------

function extractJsonBlocks(text) {
  const re = /```json\s*\n([\s\S]*?)\n```/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

// Whitespace-split word count — good enough for Vietnamese pace check; intentionally counts
// punctuation-attached tokens as one word (matches how readers see/say them).
function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function validateStoryboard(s) {
  if (s.schemaVersion !== 'v2') push('storyboard.schemaVersion', `expected "v2", got "${s.schemaVersion}"`);
  if (typeof s.dishName !== 'string' || s.dishName.length === 0) push('storyboard.dishName', 'missing or empty');
  if (typeof s.dishSlug !== 'string' || !SLUG_RE.test(s.dishSlug)) push('storyboard.dishSlug', `must match ${SLUG_RE}, got "${s.dishSlug}"`);
  if (typeof s.servingSize !== 'string') push('storyboard.servingSize', 'must be string');
  if (typeof s.cuisineStyle !== 'string') push('storyboard.cuisineStyle', 'must be string');
  if (typeof s.musicMood !== 'string') push('storyboard.musicMood', 'must be string');
  if (typeof s.totalDurationSec !== 'number') push('storyboard.totalDurationSec', 'must be number');

  if (!Array.isArray(s.panels)) { push('storyboard.panels', 'must be array'); return; }
  if (s.panels.length < MIN_PANELS || s.panels.length > MAX_PANELS) {
    push('storyboard.panels', `length ${s.panels.length} outside [${MIN_PANELS}, ${MAX_PANELS}]`);
  }

  let sum = 0;
  let complexCount = 0;
  s.panels.forEach((p, i) => {
    const at = `panels[${i}]`;
    if (p.index !== i + 1) push(`${at}.index`, `expected ${i + 1}, got ${p.index}`);
    if (!VALID_KINDS.has(p.kind)) push(`${at}.kind`, `invalid "${p.kind}"`);
    if (!VALID_DURATIONS.has(p.durationSec)) push(`${at}.durationSec`, `must be 4|6|8, got ${p.durationSec}`);
    if (!VALID_TRANSITIONS.has(p.transition)) push(`${at}.transition`, `invalid "${p.transition}"`);
    if (typeof p.imagePrompt !== 'string' || p.imagePrompt.length < 20) push(`${at}.imagePrompt`, 'missing or too short (<20 chars)');
    if (typeof p.narrationVi !== 'string' || p.narrationVi.length < 5) push(`${at}.narrationVi`, 'missing or too short');
    if (typeof p.motionDirection !== 'string') push(`${at}.motionDirection`, 'must be string');
    if (!p.imageTextLabel || typeof p.imageTextLabel.line1 !== 'string') push(`${at}.imageTextLabel.line1`, 'must be non-null string');

    // Narration must fit panel duration at VN reading pace — Remotion otherwise cuts CTA mid-word.
    if (typeof p.narrationVi === 'string' && typeof p.durationSec === 'number') {
      const words = countWords(p.narrationVi);
      const maxWords = Math.floor(p.durationSec * VN_WORDS_PER_SEC);
      if (words > maxWords) {
        push(`${at}.narrationVi`, `${words} words exceeds budget ${maxWords} for ${p.durationSec}s (≤${VN_WORDS_PER_SEC} VN words/sec)`);
      }
    }

    // motionComplexity is optional; if present, must be valid enum.
    if (p.motionComplexity !== undefined && !VALID_COMPLEXITY.has(p.motionComplexity)) {
      push(`${at}.motionComplexity`, `must be "simple" or "complex", got "${p.motionComplexity}"`);
    }
    if (p.motionComplexity === 'complex') complexCount += 1;

    if (typeof p.durationSec === 'number') sum += p.durationSec;
  });

  if (complexCount > MAX_COMPLEX_PANELS) {
    push('storyboard.panels', `motionComplexity="complex" appears ${complexCount} times, max ${MAX_COMPLEX_PANELS} per dish (Tier 1 Fast cap 10 RPD)`);
  }

  if (s.panels.length > 0) {
    if (s.panels[0].kind !== 'intro') push('panels[0].kind', `must be "intro", got "${s.panels[0].kind}"`);
    const last = s.panels[s.panels.length - 1];
    if (last.kind !== 'outro') push(`panels[last].kind`, `must be "outro", got "${last.kind}"`);
    for (let i = 1; i < s.panels.length - 1; i++) {
      if (s.panels[i].kind !== 'step') push(`panels[${i}].kind`, `middle panel must be "step", got "${s.panels[i].kind}"`);
    }
    validateOutro(last);
  }

  if (Math.abs(sum - s.totalDurationSec) > 0.01) {
    push('storyboard.totalDurationSec', `sum(durationSec)=${sum} !== totalDurationSec=${s.totalDurationSec}`);
  }
  if (sum < MIN_TOTAL_SEC || sum > MAX_TOTAL_SEC) {
    push('storyboard.totalDurationSec', `sum ${sum}s outside YouTube Shorts cap [${MIN_TOTAL_SEC}, ${MAX_TOTAL_SEC}]`);
  }
}

function validateOutro(outro) {
  if (!VALID_DURATIONS.has(outro.durationSec) || outro.durationSec === 4) {
    push('outro.durationSec', `must be 6 or 8 (CTA needs airtime), got ${outro.durationSec}`);
  }
  if (outro.imageTextLabel?.line2 !== CTA_LABEL_LINE2) {
    push('outro.imageTextLabel.line2', `must equal "${CTA_LABEL_LINE2}", got "${outro.imageTextLabel?.line2}"`);
  }
  const narration = outro.narrationVi || '';
  if (!narration.trim().endsWith(CTA_NARRATION_SUFFIX)) {
    push('outro.narrationVi', `must end with "${CTA_NARRATION_SUFFIX}"`);
  }
  if (typeof outro.imagePrompt === 'string' && !/ĐĂNG KÝ KÊNH/i.test(outro.imagePrompt)) {
    push('outro.imagePrompt', 'should bake "ĐĂNG KÝ KÊNH 🔔" overlay into image — phrase missing from prompt');
  }
}

function validateMetadata(m) {
  if (typeof m.title !== 'string' || m.title.length === 0 || m.title.length > 100) {
    push('metadata.title', `must be 1-100 chars, got length ${m.title?.length}`);
  }
  if (typeof m.descriptionVi !== 'string' || m.descriptionVi.length < 100) {
    push('metadata.descriptionVi', 'must be ≥100 chars');
  } else if (!m.descriptionVi.includes(CTA_DESCRIPTION_MARKER)) {
    push('metadata.descriptionVi', `must include CTA paragraph starting with "${CTA_DESCRIPTION_MARKER}"`);
  }
  if (typeof m.descriptionEn !== 'string' || m.descriptionEn.length < 50) push('metadata.descriptionEn', 'must be ≥50 chars');
  if (!Array.isArray(m.tags) || m.tags.length < 8 || m.tags.length > 15) push('metadata.tags', 'must be array of 8-15 entries');
  if (m.category !== 'Howto & Style') push('metadata.category', `must be "Howto & Style", got "${m.category}"`);
  if (m.defaultLanguage !== 'vi') push('metadata.defaultLanguage', `must be "vi", got "${m.defaultLanguage}"`);
  if (!Array.isArray(m.hashtags) || m.hashtags.length !== 3) push('metadata.hashtags', `must be array of EXACTLY 3, got ${m.hashtags?.length}`);
  else m.hashtags.forEach((h, i) => {
    if (typeof h !== 'string' || !h.startsWith('#')) push(`metadata.hashtags[${i}]`, `must start with "#", got "${h}"`);
  });
  if (m.publishMode !== 'private') push('metadata.publishMode', `must be "private", got "${m.publishMode}"`);
  if (m.thumbnailPrompt !== null && typeof m.thumbnailPrompt !== 'string') {
    push('metadata.thumbnailPrompt', 'must be string or null');
  }
}
