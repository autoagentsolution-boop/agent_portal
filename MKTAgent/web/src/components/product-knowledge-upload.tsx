// Product Knowledge upload: the user drops in documents/images about their product and Gemini
// reads them into a rich, factual profile that grounds every copy + image + video prompt (thin
// knowledge was the cause of generic media). Files are sent as base64 (no multipart) to
// POST /product-knowledge/analyze; when a campaignId is given the result persists to the
// campaign so all its posts inherit the richer knowledge.
import { useEffect, useRef, useState } from 'react';
import { api, type ProductKnowledgeResult, type UploadedDocInput } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

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
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductKnowledgeResult | null>(null);
  const [open, setOpen] = useState(false);
  // Save the analysis as a REUSABLE library entry (item 6) so other posts/campaigns can link it.
  // Default ON: without it an upload only lands on campaign.brandContext and never becomes
  // visible/reusable — the "my product knowledge disappeared" report.
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [libraryName, setLibraryName] = useState(product ?? '');
  // Existing product knowledge already stored on this campaign (brandContext). Fetched on
  // mount so the user SEES their prior upload persisted instead of a blank panel after reload.
  const [existing, setExisting] = useState<{ productDetails: string; brandVoice: string | null } | null>(null);
  // Inline edit of the campaign's grounding knowledge (feedback 4d: it was read-only + felt truncated).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingPk, setSavingPk] = useState(false);

  const saveKnowledge = async () => {
    const text = draft.trim();
    setSavingPk(true);
    try {
      const r = await api.updateCampaign(campaignId, { brandContext: text || null });
      if (!r.ok) { notify(t('knowledge.err.save_campaign', { error: tError(r.error) }), 'err'); return; }
      setExisting(text ? { productDetails: text, brandVoice: r.data.brandVoice ?? null } : null);
      setEditing(false);
      notify(t('knowledge.updated'));
    } finally { setSavingPk(false); }
  };

  useEffect(() => {
    let live = true;
    void api.getCampaign(campaignId).then((r) => {
      if (!live || !r.ok) return;
      if (r.data.brandContext) setExisting({ productDetails: r.data.brandContext, brandVoice: r.data.brandVoice ?? null });
      if (!product && r.data.product) setLibraryName((n) => n || r.data.product);
    });
    return () => { live = false; };
  }, [campaignId, product]);

  const analyze = async (fileList: FileList) => {
    const files = Array.from(fileList).slice(0, MAX_FILES);
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) { notify(t('knowledge.upload.too_large', { name: tooBig.name }), 'err'); return; }
    setBusy(true);
    try {
      const docs: UploadedDocInput[] = await Promise.all(
        files.map(async (f) => ({ name: f.name, mimeType: mimeOf(f), dataB64: await toB64(f) })),
      );
      const r = await api.analyzeProductKnowledge(docs, {
        campaignId,
        ...(product ? { product } : {}),
        ...(saveToLibrary ? { saveToLibrary: true, ...(libraryName.trim() ? { libraryName: libraryName.trim() } : {}) } : {}),
      });
      if (!r.ok) { notify(t('knowledge.err.analyze', { error: tError(r.error) }), 'err'); return; }
      setResult(r.data);
      setExisting({ productDetails: r.data.productDetails, brandVoice: r.data.brandVoice });
      onAnalyzed?.(r.data);
      notify(t('knowledge.upload.updated_with_cost', { tokens: r.data.cost.totalTokens, cost: r.data.cost.costUsd.toFixed(4) }));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="pk-upload card" style={{ marginBottom: 14 }}>
      <div className="spread">
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{t('knowledge.title')}</strong>
          <span className="muted" style={{ fontSize: 12 }}>{t('knowledge.upload.tagline')}</span>
        </div>
        <button className="btn small" onClick={() => setOpen((o) => !o)}>{open ? t('knowledge.upload.hide') : existing ? t('knowledge.upload.view_more') : t('knowledge.upload.add_docs')}</button>
      </div>

      {/* Re-hydrate (A): the campaign's stored product knowledge, shown so a prior upload is
          visibly persisted (it survives reloads/rebuilds — it grounds this campaign's copy). */}
      {(existing || editing) && !result && (
        <div className="pk-result" style={{ marginTop: 10 }}>
          {editing ? (
            <div className="copy-box">
              <div className="label">{t('knowledge.upload.edit_label')}</div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={savingPk}
                rows={8}
                style={{ width: '100%', marginTop: 6, resize: 'vertical', font: 'inherit' }}
                placeholder={t('knowledge.upload.edit_placeholder')}
              />
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn small primary" disabled={savingPk} onClick={() => void saveKnowledge()}>{savingPk ? t('knowledge.upload.saving') : t('common.save')}</button>
                <button className="btn small" disabled={savingPk} onClick={() => setEditing(false)}>{t('common.cancel')}</button>
              </div>
            </div>
          ) : existing && (
            <>
              <div className="copy-box">
                <div className="spread">
                  <div className="label">{t('knowledge.upload.current_label')}</div>
                  <button className="btn small" onClick={() => { setDraft(existing.productDetails); setEditing(true); }}>{t('knowledge.upload.edit_cta')}</button>
                </div>
                <div className="text" style={{ maxHeight: 220, overflowY: 'auto' }}>{existing.productDetails}</div>
              </div>
              {existing.brandVoice && <div className="row muted small" style={{ gap: 12, marginTop: 6 }}><span>{t('knowledge.entry.voice', { voice: existing.brandVoice })}</span></div>}
            </>
          )}
        </div>
      )}

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
            {t('knowledge.upload.file_hint', { maxFiles: MAX_FILES })}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={saveToLibrary} disabled={busy} onChange={(e) => setSaveToLibrary(e.target.checked)} />
              {t('knowledge.upload.save_to_library_label')}
            </label>
            {saveToLibrary && (
              <input
                value={libraryName}
                disabled={busy}
                onChange={(e) => setLibraryName(e.target.value)}
                placeholder={t('knowledge.upload.library_name_placeholder')}
                style={{ flex: 1, minWidth: 180 }}
              />
            )}
          </div>
          {busy && <p className="muted small" style={{ marginTop: 8 }}>{t('knowledge.upload.analyzing')}</p>}

          {result && (
            <div className="pk-result" style={{ marginTop: 10 }}>
              <div className="copy-box"><div className="label">{t('knowledge.upload.result_label')}</div><div className="text">{result.productDetails}</div></div>
              <div className="row muted small" style={{ gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {result.brandVoice && <span>{t('knowledge.entry.voice', { voice: result.brandVoice })}</span>}
                {result.language && <span>{t('knowledge.upload.result_language', { language: result.language })}</span>}
                <span>{t('knowledge.upload.result_cost', { tokens: result.cost.totalTokens, cost: result.cost.costUsd.toFixed(4) })}</span>
                {result.persistedToCampaign && <span>{t('knowledge.upload.saved_to_campaign')}</span>}
                {result.library && <span>{t('knowledge.upload.saved_to_library', { name: result.library.name })}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
