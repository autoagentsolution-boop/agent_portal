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
