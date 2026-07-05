// Product Knowledge upload: the user drops in documents/images about their product and Gemini
// reads them into a rich, factual profile that grounds every copy + image + video prompt (thin
// knowledge was the cause of generic media). Files are sent as base64 (no multipart) to
// POST /product-knowledge/analyze; when a campaignId is given the result persists to the
// campaign so all its posts inherit the richer knowledge.
import { useRef, useState } from 'react';
import { api, type ProductKnowledgeResult, type UploadedDocInput } from '../api/client';

interface Props {
  campaignId: string;
  product?: string;
  notify: (msg: string, kind?: 'ok' | 'err') => void;
  onAnalyzed?: (r: ProductKnowledgeResult) => void;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown';
const MAX_FILES = 6;
const MAX_BYTES = 6 * 1024 * 1024; // ~6MB/file → within the route's 20mb body budget for a few files.

// Read a File to raw base64 (strip the "data:<mime>;base64," prefix the API doesn't want).
const toB64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;base64,/, ''));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });

const mimeOf = (f: File): string => f.type || (f.name.endsWith('.md') ? 'text/markdown' : f.name.endsWith('.txt') ? 'text/plain' : '');

export function ProductKnowledgeUpload({ campaignId, product, notify, onAnalyzed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductKnowledgeResult | null>(null);
  const [open, setOpen] = useState(false);

  const analyze = async (fileList: FileList) => {
    const files = Array.from(fileList).slice(0, MAX_FILES);
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) { notify(`"${tooBig.name}" is over 6MB — use a smaller file.`, 'err'); return; }
    setBusy(true);
    try {
      const docs: UploadedDocInput[] = await Promise.all(
        files.map(async (f) => ({ name: f.name, mimeType: mimeOf(f), dataB64: await toB64(f) })),
      );
      const r = await api.analyzeProductKnowledge(docs, { campaignId, ...(product ? { product } : {}) });
      if (!r.ok) { notify(`Analyze: ${r.error.error}`, 'err'); return; }
      setResult(r.data);
      onAnalyzed?.(r.data);
      notify(`Product knowledge updated (${r.data.cost.totalTokens} tokens · $${r.data.cost.costUsd.toFixed(4)})`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="pk-upload card" style={{ marginBottom: 14 }}>
      <div className="spread">
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ fontSize: 14 }}>📚 Product Knowledge</strong>
          <span className="muted" style={{ fontSize: 12 }}>Upload docs/images so copy, images & video are grounded in real facts</span>
        </div>
        <button className="btn small" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Add documents'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => { if (e.target.files?.length) void analyze(e.target.files); }}
          />
          <div className="help-text" style={{ marginTop: 4 }}>
            PDF, PNG/JPG/WebP, or TXT/Markdown · up to {MAX_FILES} files · ~6MB each. Gemini reads them into the product profile below.
          </div>
          {busy && <p className="muted small" style={{ marginTop: 8 }}>Analyzing documents…</p>}

          {result && (
            <div className="pk-result" style={{ marginTop: 10 }}>
              <div className="copy-box"><div className="label">Product profile (grounds every prompt)</div><div className="text">{result.productDetails}</div></div>
              <div className="row muted small" style={{ gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {result.brandVoice && <span>Voice: {result.brandVoice}</span>}
                {result.language && <span>Language: {result.language}</span>}
                <span>Cost: {result.cost.totalTokens} tok · ${result.cost.costUsd.toFixed(4)}</span>
                {result.persistedToCampaign && <span>✓ saved to campaign</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
