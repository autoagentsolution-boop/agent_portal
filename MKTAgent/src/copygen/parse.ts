// Parse Gemini structured-JSON → copy variants (T3 shape). Keeps the hard length
// safety-net (threads ≤480, x ≤280) in case the model overshoots its instruction.
// CopyVariants is the language-agnostic bag persisted to Post.copy:
//   body    → long copy for Facebook/Instagram/LinkedIn
//   threads → standalone ≤480
//   x       → standalone ≤280
export interface CopyVariants {
  body: string;
  threads: string;
  x: string;
}

export type ParseResult =
  | { ok: true; copy: CopyVariants }
  | { ok: false; error: string };

// Truncate at a word boundary and add an ellipsis (verbatim from n8n).
const cap = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 3);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
};

// Extract the model's JSON text from a Gemini response, or throw a faithful error.
const geminiText = (resp: any): string => {
  if (resp && resp.error) {
    const e = resp.error;
    throw new Error(`Gemini HTTP ${e.status || e.code || ''}: ${e.message || 'upstream error'}`);
  }
  const cand = resp?.candidates?.[0];
  const text = cand?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`empty Gemini response (finishReason=${cand?.finishReason || 'none'})`);
  return text;
};

export type VariantsResult =
  | { ok: true; variants: CopyVariants[] }
  | { ok: false; error: string };

const toVariant = (v: any): CopyVariants => ({
  body: String(v?.body || '').trim(),
  threads: cap(String(v?.threads || '').trim(), 480),
  x: cap(String(v?.x || '').trim(), 280),
});

// Recover complete {body,threads,x} objects from a TRUNCATED variants JSON (output cut mid-string
// → JSON.parse throws "Unterminated string"). Walks the text tracking string/escape state, collects
// every balanced {…} block, and parses each independently — an incomplete trailing object is simply
// dropped. Lets a partially-generated response still yield usable variants instead of failing the node.
const salvageVariants = (text: string): CopyVariants[] => {
  const out: CopyVariants[] = [];
  const stack: number[] = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push(i);
    else if (c === '}') {
      const s = stack.pop();
      if (s !== undefined) {
        try {
          const obj = JSON.parse(text.slice(s, i + 1));
          if (obj && typeof obj.body === 'string') out.push(toVariant(obj));
        } catch { /* skip a malformed block */ }
      }
    }
  }
  return out.filter((v) => v.body);
};

// Parse the multi-variant response { variants: [{body,threads,x}, …] }. Keeps the same
// length safety-net per variant; drops any variant missing a body rather than failing all.
// On a truncated response, salvages the complete variants instead of hard-failing.
export function parseVariants(resp: any): VariantsResult {
  let text: string;
  try {
    text = geminiText(resp); // may throw on an upstream/empty error — surface that faithfully
  } catch (e) {
    return { ok: false, error: 'copygen: ' + (e instanceof Error ? e.message : String(e)) };
  }
  try {
    const parsed = JSON.parse(text);
    const arr: any[] = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const variants = arr.map(toVariant).filter((v) => v.body);
    if (variants.length === 0) throw new Error('no usable variants in model output');
    return { ok: true, variants };
  } catch {
    // Truncated / malformed JSON → salvage the complete variant objects.
    const salvaged = salvageVariants(text);
    if (salvaged.length > 0) return { ok: true, variants: salvaged };
    return { ok: false, error: 'copygen: could not parse or salvage any variant from model output' };
  }
}

export function parseGeminiResponse(resp: any): ParseResult {
  try {
    // Upstream HTTP/quota error: surface the real Gemini message, not "empty".
    if (resp && resp.error) {
      const e = resp.error;
      const code = e.status || e.code || '';
      const msg = e.message || 'upstream error';
      throw new Error(`Gemini HTTP ${code}: ${msg}`);
    }
    const cand = resp?.candidates?.[0];
    const finish = cand?.finishReason;
    const text = cand?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`empty Gemini response (finishReason=${finish || 'none'})`);

    const parsed = JSON.parse(text);
    const body = String(parsed.body || '').trim();
    let threads = String(parsed.threads || '').trim();
    let x = String(parsed.x || '').trim();
    if (!body) throw new Error('missing body in model output');

    threads = cap(threads, 480);
    x = cap(x, 280);

    return { ok: true, copy: { body, threads, x } };
  } catch (e) {
    return { ok: false, error: 'copygen: ' + (e instanceof Error ? e.message : String(e)) };
  }
}
