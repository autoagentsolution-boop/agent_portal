#!/usr/bin/env node
/**
 * Add a dedicated copyX field (English, <=280) so X gets its own variant instead
 * of borrowing copyThreads (whose 300-450 target always overflowed X's 280 cap).
 *
 * One Gemini call now emits 4 strings:
 *   copyVi/copyEn  -> Facebook + Instagram + LinkedIn (shared, long-form)
 *   copyThreads    -> Threads (English, <=480)
 *   copyX          -> X (English, <=280)  [NEW]
 *
 * Touches:
 *   copy-gen: Build Gemini request (prompt + responseSchema), Parse copy, Write node (schema+value)
 *   scheduler: Build X request (read copyX, fallback chain)
 */
const fs = require('fs');
const path = require('path');

// ---------- 1) copy-gen ----------
const CG = path.join(__dirname, '..', 'n8n-workflows', 'mkt-copy-gen.json');
const cg = JSON.parse(fs.readFileSync(CG, 'utf8'));

// 1a) Build Gemini request: add copyX instruction line + schema property + required
const build = cg.nodes.find((n) => n.name === 'Build Gemini request');
if (!build) throw new Error('missing Build Gemini request');
let bj = build.parameters.jsCode;

// inject a copyX instruction right after the Threads instruction line in the system[] array
const threadsLineMarker = "  'ƯU TIÊN BRIEF:";
const copyXLine =
  "  'BẢN X/TWITTER RIÊNG (copyX): viết MỘT tweet tự thân cho X, TỐI ĐA 280 KÝ TỰ (kể cả emoji/hashtag) — KHÔNG được vượt 280. 1 hook ≤50 ký tự, 1 câu giá trị, 1 CTA ngắn (vd \"link in bio\"), 1-2 hashtag #DAIS. KHÔNG chèn URL thật vào text (X tính phí cao cho post có link). VIẾT BẰNG TIẾNG ANH, đứng độc lập, không cụt câu.',\n";
if (!bj.includes('copyX')) {
  bj = bj.replace(threadsLineMarker, copyXLine + threadsLineMarker);
  // schema: add copyX property + required
  bj = bj.replace(
    'copyThreads: { type: \'STRING\' } },',
    "copyThreads: { type: 'STRING' }, copyX: { type: 'STRING' } },"
  );
  bj = bj.replace(
    "required: ['copyVi', 'copyEn', 'copyThreads']",
    "required: ['copyVi', 'copyEn', 'copyThreads', 'copyX']"
  );
  build.parameters.jsCode = bj;
  console.log('  [copy-gen] Build Gemini request: +copyX prompt/schema');
} else {
  console.log('  [copy-gen] Build already has copyX, skip');
}

// 1b) Parse copy: extract + cap copyX at 280
const parse = cg.nodes.find((n) => n.name === 'Parse copy');
let pj = parse.parameters.jsCode;
if (!pj.includes('copyX')) {
  pj = pj.replace(
    "let copyVi = '', copyEn = '', copyThreads = '', err = '';",
    "let copyVi = '', copyEn = '', copyThreads = '', copyX = '', err = '';"
  );
  pj = pj.replace(
    "copyThreads = String(parsed.copyThreads || '').trim();",
    "copyThreads = String(parsed.copyThreads || '').trim();\n  copyX = String(parsed.copyX || '').trim();"
  );
  // add X 280 safety net right after the Threads 480 cap
  pj = pj.replace(
    "if (copyThreads.length > 480) { copyThreads = copyThreads.slice(0, 477); copyThreads = copyThreads.slice(0, copyThreads.lastIndexOf(' ')) + '…'; }",
    "if (copyThreads.length > 480) { copyThreads = copyThreads.slice(0, 477); copyThreads = copyThreads.slice(0, copyThreads.lastIndexOf(' ')) + '…'; }\n  if (copyX.length > 280) { copyX = copyX.slice(0, 277); copyX = copyX.slice(0, copyX.lastIndexOf(' ')) + '…'; }"
  );
  pj = pj.replace(
    "copyVi, copyEn, copyThreads, ok: !err, error: err } }];",
    "copyVi, copyEn, copyThreads, copyX, ok: !err, error: err } }];"
  );
  parse.parameters.jsCode = pj;
  console.log('  [copy-gen] Parse copy: +copyX extract/cap');
}

// 1c) Write node: add copyX to schema + value map
const write = cg.nodes.find((n) => n.name === 'Write copy + status=review');
const cols = write.parameters.columns;
if (!cols.value.copyX) {
  cols.value.copyX = '={{ $json.copyX }}';
  cols.schema.push({
    id: 'copyX',
    displayName: 'copyX',
    required: false,
    defaultMatch: false,
    display: true,
    type: 'string',
    canBeUsedToMatch: true,
  });
  console.log('  [copy-gen] Write node: +copyX schema/value');
}

fs.writeFileSync(CG, JSON.stringify(cg, null, 2) + '\n');

// ---------- 2) scheduler: Build X request reads copyX ----------
const PS = path.join(__dirname, '..', 'n8n-workflows', 'mkt-post-scheduler.json');
const ps = JSON.parse(fs.readFileSync(PS, 'utf8'));
const bx = ps.nodes.find((n) => n.id === 'build-x-request');
let xj = bx.parameters.jsCode;
// prefer copyX, then copyThreads, then copyVi; keep the 280 truncation safety net
xj = xj.replace(
  "let text = String(spec.copyThreads || '').trim();\nif (!text) { text = String(spec.copyVi || ''); }",
  "let text = String(spec.copyX || '').trim();\nif (!text) text = String(spec.copyThreads || '').trim();\nif (!text) text = String(spec.copyVi || '');"
);
bx.parameters.jsCode = xj;
// also surface copyX in Build post spec so it reaches Validate assets -> Build X request
const bs = ps.nodes.find((n) => n.id === 'build-spec');
let sj = bs.parameters.jsCode;
if (!sj.includes('copyX')) {
  sj = sj.replace(
    "copyThreads: row.copyThreads || '',",
    "copyThreads: row.copyThreads || '',\n  copyX: row.copyX || '',"
  );
  bs.parameters.jsCode = sj;
  console.log('  [scheduler] Build post spec: +copyX passthrough');
}
console.log('  [scheduler] Build X request: read copyX first');

fs.writeFileSync(PS, JSON.stringify(ps, null, 2) + '\n');
console.log('OK: copyX field wired end-to-end.');
