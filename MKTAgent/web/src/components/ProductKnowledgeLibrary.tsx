// Product Knowledge library view (item C): one place to see every reusable product profile
// the user has saved, confirm it persisted, edit it, or delete it. The per-campaign upload
// widget (ProductKnowledgeUpload) creates these; here they are managed centrally. All routes
// are owner-scoped (GET/PATCH/DELETE /product-knowledge). No file storage — profiles are text.
import { useEffect, useRef, useState } from 'react';
import { api, type ProductKnowledgeEntry, type UploadedDocInput, type CampaignDto } from '../api/client';
import { useLocale } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props {
  notify: (msg: string, kind?: 'ok' | 'err') => void;
}

const MAX_BYTES = 6 * 1024 * 1024;
const toB64 = (f: File): Promise<string> =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^;]*;base64,/, '')); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(f); });
const summaryOf = (p: unknown): string => {
  const s = (p as { productSummary?: string } | null)?.productSummary;
  return typeof s === 'string' && s.trim() ? s.trim() : '';
};

export function ProductKnowledgeLibrary({ notify }: Props) {
  const { t } = useLocale();
  const [entries, setEntries] = useState<ProductKnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; productDetails: string; brandVoice: string }>({ name: '', productDetails: '', brandVoice: '' });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importName, setImportName] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  // Import a NEW product from documents (Gemini analysis → a reusable library entry). Campaign-less
  // (saveToLibrary with no campaignId), so this page is a standalone place to build the library.
  const importDocs = async (fileList: FileList) => {
    const files = Array.from(fileList).slice(0, 6);
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) { notify(t('knowledge.import.too_large', { name: tooBig.name }), 'err'); return; }
    setImporting(true);
    try {
      const docs: UploadedDocInput[] = await Promise.all(files.map(async (f) => ({ name: f.name, mimeType: f.type || 'application/pdf', dataB64: await toB64(f) })));
      const r = await api.analyzeProductKnowledge(docs, { saveToLibrary: true, ...(importName.trim() ? { libraryName: importName.trim() } : {}) });
      if (!r.ok) { notify(t('knowledge.err.import', { error: tError(r.error) }), 'err'); return; }
      notify(t('knowledge.import.success', { tokens: r.data.cost.totalTokens, cost: r.data.cost.costUsd.toFixed(4) }));
      setImportName('');
      await load();
    } finally { setImporting(false); if (importRef.current) importRef.current.value = ''; }
  };

  const [campaignProducts, setCampaignProducts] = useState<CampaignDto[]>([]);

  const load = async () => {
    setLoading(true);
    const [r, c] = await Promise.all([api.listProductKnowledge(), api.listCampaigns()]);
    if (r.ok) setEntries(r.data);
    else notify(t('knowledge.err.load', { error: tError(r.error) }), 'err');
    // Product knowledge added at a campaign lives on campaign.brandContext (not the reusable
    // library). Surface those too so a user sees what they already added for their posts.
    if (c.ok) setCampaignProducts(c.data.filter((cp) => Boolean(cp.brandContext)));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (e: ProductKnowledgeEntry) => {
    setEditId(e.id);
    setOpenId(e.id);
    setDraft({ name: e.name, productDetails: e.productDetails, brandVoice: e.brandVoice ?? '' });
  };

  const save = async (id: string) => {
    if (!draft.name.trim() || !draft.productDetails.trim()) { notify(t('knowledge.validation.required'), 'err'); return; }
    setSaving(true);
    const r = await api.updateProductKnowledge(id, {
      name: draft.name.trim(),
      productDetails: draft.productDetails.trim(),
      brandVoice: draft.brandVoice.trim() || null,
    });
    setSaving(false);
    if (!r.ok) { notify(t('knowledge.err.save', { error: tError(r.error) }), 'err'); return; }
    setEditId(null);
    notify(t('knowledge.updated'));
    await load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(t('knowledge.delete.confirm', { name }))) return;
    const r = await api.deleteProductKnowledge(id);
    if (!r.ok) { notify(t('knowledge.err.delete', { error: tError(r.error) }), 'err'); return; }
    notify(t('knowledge.deleted'));
    await load();
  };

  return (
    <div className="pk-library">
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">{t('knowledge.eyebrow')}</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>{t('knowledge.title')}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>{t('knowledge.subtitle')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input value={importName} disabled={importing} onChange={(e) => setImportName(e.target.value)} placeholder={t('knowledge.import.name_placeholder')} style={{ width: 160 }} />
          <button className="btn primary small" disabled={importing} onClick={() => importRef.current?.click()}>{importing ? t('knowledge.import.busy') : t('knowledge.import.cta')}</button>
          <input ref={importRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.length) void importDocs(e.target.files); }} />
        </div>
      </div>

      {loading ? (
        <div className="muted">{t('common.loading')}</div>
      ) : entries.length === 0 && campaignProducts.length === 0 ? (
        <p className="muted">{t('knowledge.empty.pre')} <strong>{t('knowledge.import.cta')}</strong> {t('knowledge.empty.post')}</p>
      ) : (
        <div className="post-summary-list">
          {entries.map((e) => (
            <div key={e.id} className="card" style={{ padding: 14 }}>
              <div className="spread">
                <button className="pk-lib-head" onClick={() => setOpenId((id) => (id === e.id ? null : e.id))}>
                  <div><strong>{e.name}</strong>
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      {e.language ?? t('knowledge.entry.no_language')}{e.sourceDocs.length ? ` · ${t('knowledge.entry.doc_count', { count: e.sourceDocs.length })}` : ''} · {t('knowledge.entry.updated', { date: new Date(e.updatedAt).toLocaleDateString() })}
                    </span>
                  </div>
                  {/* Short summary so the user scans their products at a glance without expanding. */}
                  {(summaryOf(e.profile) || e.productDetails) && (
                    <div className="muted small pk-summary">{summaryOf(e.profile) || e.productDetails}</div>
                  )}
                </button>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={() => startEdit(e)}>{t('knowledge.entry.edit_cta')}</button>
                  <button className="btn small danger" onClick={() => void remove(e.id, e.name)}>{t('common.delete')}</button>
                </div>
              </div>

              {openId === e.id && editId !== e.id && (
                <div className="pk-result" style={{ marginTop: 10 }}>
                  <div className="copy-box"><div className="label">{t('knowledge.entry.profile_label')}</div><div className="text">{e.productDetails}</div></div>
                  {e.brandVoice && <div className="row muted small" style={{ gap: 12, marginTop: 6 }}><span>{t('knowledge.entry.voice', { voice: e.brandVoice })}</span></div>}
                  {e.sourceDocs.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>{t('knowledge.entry.source_docs', { docs: e.sourceDocs.join(', ') })}</div>}
                </div>
              )}

              {editId === e.id && (
                <div style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>{t('knowledge.entry.name_label')}</label>
                    <input value={draft.name} onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('knowledge.entry.profile_label')}</label>
                    <textarea rows={6} value={draft.productDetails} onChange={(ev) => setDraft((d) => ({ ...d, productDetails: ev.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{t('knowledge.entry.voice_label')}</label>
                    <input value={draft.brandVoice} onChange={(ev) => setDraft((d) => ({ ...d, brandVoice: ev.target.value }))} />
                  </div>
                  <div className="btn-row">
                    <button className="btn primary" disabled={saving} onClick={() => void save(e.id)}>{saving ? t('knowledge.entry.saving') : t('common.save')}</button>
                    <button className="btn" disabled={saving} onClick={() => setEditId(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Product knowledge added at a campaign (brandContext) — what grounds that campaign's
          posts. Read-only here; to make it a reusable, editable entry, import it to the library. */}
      {!loading && campaignProducts.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow">{t('knowledge.from_campaigns.title')}</div>
          <p className="muted small" style={{ margin: '2px 0 8px' }}>{t('knowledge.from_campaigns.subtitle')}</p>
          <div className="post-summary-list">
            {campaignProducts.map((c) => (
              <div key={c.id} className="card" style={{ padding: 14 }}>
                <div><strong>{c.product}</strong> <span className="muted small">· {t('knowledge.campaign.label')}{c.language ? ` · ${c.language}` : ''}</span></div>
                {c.brandContext && <div className="muted small pk-summary">{c.brandContext}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
