// Parse Gemini structured-JSON → copy variants. Ported from the n8n "Parse copy"
// node, including the hard length safety-net (Threads ≤480, X ≤280) in case the
// model overshoots its own instruction.
export interface CopyVariants {
  copyVi: string;
  copyEn: string;
  copyThreads: string;
  copyX: string;
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
    const copyVi = String(parsed.copyVi || '').trim();
    const copyEn = String(parsed.copyEn || '').trim();
    let copyThreads = String(parsed.copyThreads || '').trim();
    let copyX = String(parsed.copyX || '').trim();
    if (!copyVi || !copyEn) throw new Error('missing copyVi/copyEn in model output');

    copyThreads = cap(copyThreads, 480);
    copyX = cap(copyX, 280);

    return { ok: true, copy: { copyVi, copyEn, copyThreads, copyX } };
  } catch (e) {
    return { ok: false, error: 'copygen: ' + (e instanceof Error ? e.message : String(e)) };
  }
}
