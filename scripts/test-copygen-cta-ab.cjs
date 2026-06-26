#!/usr/bin/env node
/**
 * A/B test the conditional lead-form CTA in mkt-copy-gen WITHOUT touching the
 * calendar sheet or posting. Runs the EXACT "Build Gemini request" prompt logic
 * (ported verbatim from n8n-workflows/mkt-copy-gen.json) twice on the same row:
 *   A = leadsForm SET (link injected)   B = leadsForm EMPTY (generic CTA)
 * Then reports per-variant char counts + whether the form URL landed in each copy.
 *
 * Usage: GEMINI_API_KEY=... node scripts/test-copygen-cta-ab.cjs
 * Row 7 (test-leads) values are inlined below from the live calendar tab.
 */

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// --- Row 7 from calendar tab (read live, not invented) ----------------------
const ROW = {
  product: 'AgentPortal',
  angle: 'nhấn mạnh tự động đăng bài, sales chỉ duyệt',
  length: 'long',
  status: 'rework',
  feedback: 'Bỏ "Content cho sales:" ở đầu. Mở thẳng bằng câu giật gân về thời gian phí cho content. Auto và tăng chất lượng có leads lên 20-30%. Tự động hóa mọi thứ và tích hợp vào dashboard',
  leadsForm: 'https://forms.gle/ogsWh2pZx2nmG2HE7',
};

// --- buildGeminiBody: VERBATIM port of node "Build Gemini request" ----------
// Only difference from the node: leadsForm comes from an arg so we can flip
// that one variable. Everything else is identical.
function buildGeminiBody(row, leadsFormValue) {
  const product = String(row.product || '').trim();
  const angle = String(row.angle || '').trim();
  const lengthRaw = String(row.length || '').trim().toLowerCase();
  const isRework = String(row.status || '').trim() === 'rework';
  const feedback = String(row.feedback || '').trim();
  const leadsForm = String(leadsFormValue || '').trim();
  if (!product) throw new Error('mkt_copygen: row missing product');

  let lengthSpec = 'khoảng 130-220 từ';
  if (lengthRaw) {
    if (['short', 'ngắn', 'ngan'].includes(lengthRaw)) lengthSpec = 'ngắn gọn, khoảng 80-130 từ';
    else if (['medium', 'vừa', 'vua'].includes(lengthRaw)) lengthSpec = 'khoảng 130-220 từ';
    else if (['long', 'dài', 'dai'].includes(lengthRaw)) lengthSpec = 'dài, khoảng 220-320 từ';
    else if (/^\d+$/.test(lengthRaw)) lengthSpec = `khoảng ${lengthRaw} từ (cho phép lệch ±15%)`;
  }

  const system = [
    'Bạn là copywriter mạng xã hội cho Data Agentic Solutions (DAIS) — công ty làm nền tảng & giải pháp công nghệ dễ dùng, triển khai gọn, bám vận hành thực tế.',
    'Viết 1 bài đăng Facebook/Threads có tính kéo tương tác cao. Viết như MỘT CON NGƯỜI đang chia sẻ, KHÔNG phải brand đang quảng cáo.',
    'ĐỊNH DẠNG (guardrail cứng): KHÔNG dùng HTML/markdown (không <br>, <b>, **). Chỉ newline thật để tách dòng. Câu ngắn (<20 từ). Nhiều khoảng trắng giữa các dòng cho dễ đọc trên mobile.',
    'CẤU TRÚC NỀN cho copyVi (copyEn dịch tương đương tự nhiên, giữ cùng sức nặng hook): HOOK dòng đầu TỐI ĐA 50 KÝ TỰ (kể cả emoji & dấu câu) — là số/tình huống cụ thể, câu trái chiều, hoặc thừa nhận nỗi đau; không vòng vo, không tên sản phẩm ở hook. Sau đó: dòng trống; re-hook đào sâu; dòng trống; thân 2-3 dòng emoji-led nói KẾT QUẢ vận hành cho con người (không liệt kê tính năng); dòng trống; 1 dòng chốt; 1 câu hỏi CỤ THỂ gây thảo luận (tránh "bạn nghĩ sao?"); 1 CTA duy nhất; dòng cuối 4-6 hashtag bắt đầu #DAIS.',
    `YÊU CẦU ĐỘ DÀI: copyVi ${lengthSpec}. Tổng 4-6 emoji. TUYỆT ĐỐI tránh sáo rỗng và các từ: "giải pháp đột phá", "khám phá", "thay đổi cuộc chơi", "nâng tầm", "tối ưu hiệu suất tức thì". Không bịa số liệu, KHÔNG bịa % hay con số nếu brief không cung cấp, không hứa hẹn quá mức.`,
    'BẢN THREADS RIÊNG (copyThreads): viết MỘT phiên bản RÚT GỌN tự thân cho Threads, TỐI ĐA 480 ký tự (mục tiêu 300-450). KHÔNG cắt từ copyVi — viết lại: 1 hook mạnh ≤50 ký tự, 1-2 dòng thân nói kết quả, 1 câu chốt + 1 CTA, 2-3 hashtag #DAIS. Phải đứng được như một post hoàn chỉnh, không cụt câu, không thiếu CTA. VIẾT BẰNG TIẾNG ANH (Threads audience chủ yếu dùng tiếng Anh) — KHÔNG dùng tiếng Việt; giữ cùng thông điệp & sức nặng hook như copyVi nhưng diễn đạt tự nhiên bằng tiếng Anh.',
    'BẢN X/TWITTER RIÊNG (copyX): viết MỘT tweet tự thân cho X, TỐI ĐA 280 KÝ TỰ (kể cả emoji/hashtag) — KHÔNG được vượt 280. 1 hook ≤50 ký tự, 1 câu giá trị, 1 CTA ngắn (vd "link in bio"), 1-2 hashtag #DAIS. KHÔNG chèn URL thật vào text (X tính phí cao cho post có link). VIẾT BẰNG TIẾNG ANH, đứng độc lập, không cụt câu.',
    'ƯU TIÊN BRIEF: Nếu phần "Góc tiếp cận (angle)" có yêu cầu riêng về bố cục / giọng / cách kể / điểm nhấn → TUÂN THEO brief đó (linh hoạt cấu trúc nền), MIỄN vẫn giữ guardrail cứng (không HTML, hook ≤50 ký tự, tránh sáo rỗng, đúng độ dài). Angle ưu tiên cao hơn cấu trúc nền.'
  ];
  if (leadsForm) {
    system.push(`LINK THU LEAD: bài này có form thu lead = ${leadsForm}. Trong CTA của copyVi, copyEn VÀ copyThreads, dùng ĐÚNG link này (viết nguyên URL) làm lời kêu gọi để lại thông tin / đăng ký — KHÔNG dùng "link in bio" cho 3 bản đó. copyThreads vẫn phải ≤480 ký tự KỂ CẢ link (rút gọn phần thân để chừa chỗ cho URL, không cụt câu). RIÊNG copyX: TUYỆT ĐỐI KHÔNG chèn URL thật (X tính phí cao cho link) — giữ "link in bio". Mỗi bản chỉ 1 CTA, không spam link.`);
  }
  const systemText = system.join('\n');

  let user = `Sản phẩm/dịch vụ: ${product}\nGóc tiếp cận (angle): ${angle || '(tự chọn góc phù hợp, nhấn lợi ích vận hành)'}\nViết copyVi và copyEn.`;
  if (isRework && feedback) user += `\n\nLƯU Ý: bản trước đã bị TỪ CHỐI. Feedback của người duyệt: "${feedback}". Hãy viết lại để KHẮC PHỤC đúng các điểm này, đừng lặp lại lỗi cũ.`;
  else if (isRework) user += `\n\nLƯU Ý: bản trước đã bị từ chối (không có ghi chú cụ thể). Hãy viết một phiên bản KHÁC HẲN về hook và cách tiếp cận.`;

  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.95, topP: 0.95, maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { copyVi: { type: 'STRING' }, copyEn: { type: 'STRING' }, copyThreads: { type: 'STRING' }, copyX: { type: 'STRING' } },
        required: ['copyVi', 'copyEn', 'copyThreads', 'copyX'],
      },
    },
  };
}

// --- applyCaps: VERBATIM caps from node "Parse copy" ------------------------
function applyCaps(p) {
  let copyVi = String(p.copyVi || '').trim();
  let copyEn = String(p.copyEn || '').trim();
  let copyThreads = String(p.copyThreads || '').trim();
  let copyX = String(p.copyX || '').trim();
  const capped = { threads: false, x: false };
  if (copyThreads.length > 480) { copyThreads = copyThreads.slice(0, 477); copyThreads = copyThreads.slice(0, copyThreads.lastIndexOf(' ')) + '…'; capped.threads = true; }
  if (copyX.length > 280) { copyX = copyX.slice(0, 277); copyX = copyX.slice(0, copyX.lastIndexOf(' ')) + '…'; capped.x = true; }
  return { copyVi, copyEn, copyThreads, copyX, capped };
}

// Gemini sometimes emits raw control chars inside JSON string values; escape any
// control char that sits inside a string literal, then parse.
function tolerantParse(text) {
  try { return JSON.parse(text); } catch (_) {}
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], code = text.charCodeAt(i);
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && code < 0x20) {
      if (code === 10) out += '\\n';
      else if (code === 13) out += '\\r';
      else if (code === 9) out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

async function callGemini(body, tries = 3) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + KEY;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('empty Gemini response (finishReason=' + (j?.candidates?.[0]?.finishReason || 'none') + ')');
      return tolerantParse(text);
    } catch (e) { last = e; }
  }
  throw last;
}

const FORM = ROW.leadsForm;
function linkState(s) { return s.includes(FORM) ? 'YES' : (s.toLowerCase().includes('link in bio') ? 'link-in-bio' : 'no'); }

function report(label, c) {
  console.log(`\n===== ${label} =====`);
  for (const k of ['copyVi', 'copyEn', 'copyThreads', 'copyX']) {
    const v = c[k];
    const cap = (k === 'copyThreads' && c.capped.threads) ? ' [CAPPED]' : (k === 'copyX' && c.capped.x) ? ' [CAPPED]' : '';
    console.log(`  ${k.padEnd(12)} len=${String(v.length).padStart(4)}  link=${linkState(v).padEnd(11)}${cap}`);
  }
  for (const k of ['copyVi', 'copyEn', 'copyThreads', 'copyX']) {
    console.log(`  --- ${k} ---\n` + c[k].split('\n').map(l => '    ' + l).join('\n'));
  }
}

(async () => {
  console.log('A/B test: same row 7 (test-leads), toggling leadsForm only.');
  console.log('Form URL =', FORM, '(len ' + FORM.length + ')');

  const bodyA = buildGeminiBody(ROW, ROW.leadsForm); // leadsForm SET
  const bodyB = buildGeminiBody(ROW, '');             // leadsForm EMPTY
  const [rawA, rawB] = await Promise.all([callGemini(bodyA), callGemini(bodyB)]);
  const A = applyCaps(rawA);
  const B = applyCaps(rawB);

  report('A · leadsForm SET (link injected)', A);
  report('B · leadsForm EMPTY (generic CTA)', B);

  console.log('\n===== DELTA (A vs B) =====');
  for (const k of ['copyVi', 'copyEn', 'copyThreads', 'copyX']) {
    console.log(`  ${k.padEnd(12)} A=${String(A[k].length).padStart(4)}  B=${String(B[k].length).padStart(4)}  delta=${A[k].length - B[k].length}`);
  }
  console.log('\nCap check: copyThreads<=480 ? A=' + (A.copyThreads.length <= 480) + ' B=' + (B.copyThreads.length <= 480) +
    '  | copyX<=280 ? A=' + (A.copyX.length <= 280) + ' B=' + (B.copyX.length <= 280));
  console.log('Link rule: A.copyX has NO url ? ' + (!A.copyX.includes(FORM)) +
    '  | A.copyThreads HAS url ? ' + A.copyThreads.includes(FORM) +
    '  | A.copyVi HAS url ? ' + A.copyVi.includes(FORM));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
