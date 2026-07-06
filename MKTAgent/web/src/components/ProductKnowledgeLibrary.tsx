// Product Knowledge library view (item C): one place to see every reusable product profile
// the user has saved, confirm it persisted, edit it, or delete it. The per-campaign upload
// widget (ProductKnowledgeUpload) creates these; here they are managed centrally. All routes
// are owner-scoped (GET/PATCH/DELETE /product-knowledge). No file storage — profiles are text.
import { useEffect, useRef, useState } from 'react';
import { api, type ProductKnowledgeEntry, type UploadedDocInput, type CampaignDto } from '../api/client';

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
    if (tooBig) { notify(`"${tooBig.name}" is over 6MB`, 'err'); return; }
    setImporting(true);
    try {
      const docs: UploadedDocInput[] = await Promise.all(files.map(async (f) => ({ name: f.name, mimeType: f.type || 'application/pdf', dataB64: await toB64(f) })));
      const r = await api.analyzeProductKnowledge(docs, { saveToLibrary: true, ...(importName.trim() ? { libraryName: importName.trim() } : {}) });
      if (!r.ok) { notify(`Import: ${r.error.error}`, 'err'); return; }
      notify(`Imported (${r.data.cost.totalTokens} tokens · $${r.data.cost.costUsd.toFixed(4)})`);
      setImportName('');
      await load();
    } finally { setImporting(false); if (importRef.current) importRef.current.value = ''; }
  };

  const [campaignProducts, setCampaignProducts] = useState<CampaignDto[]>([]);

  const load = async () => {
    setLoading(true);
    const [r, c] = await Promise.all([api.listProductKnowledge(), api.listCampaigns()]);
    if (r.ok) setEntries(r.data);
    else notify(`Load failed: ${r.error.error}`, 'err');
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
    if (!draft.name.trim() || !draft.productDetails.trim()) { notify('Name and details are required', 'err'); return; }
    setSaving(true);
    const r = await api.updateProductKnowledge(id, {
      name: draft.name.trim(),
      productDetails: draft.productDetails.trim(),
      brandVoice: draft.brandVoice.trim() || null,
    });
    setSaving(false);
    if (!r.ok) { notify(`Save failed: ${r.error.error}`, 'err'); return; }
    setEditId(null);
    notify('Product knowledge updated');
    await load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}”? Posts linked to it fall back to their campaign's knowledge.`)) return;
    const r = await api.deleteProductKnowledge(id);
    if (!r.ok) { notify(`Delete failed: ${r.error.error}`, 'err'); return; }
    notify('Deleted');
    await load();
  };

  return (
    <div className="pk-library">
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">Library</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>📚 Product Knowledge</h2>
          <p className="muted small" style={{ marginTop: 4 }}>Your products — each profile grounds copy, image and video prompts. Import docs to add one, edit inline, or delete. Profiles are text — the original files are not stored.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input value={importName} disabled={importing} onChange={(e) => setImportName(e.target.value)} placeholder="Product name (optional)" style={{ width: 160 }} />
          <button className="btn primary small" disabled={importing} onClick={() => importRef.current?.click()}>{importing ? 'Analyzing…' : '+ Import product'}</button>
          <input ref={importRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.length) void importDocs(e.target.files); }} />
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : entries.length === 0 && campaignProducts.length === 0 ? (
        <p className="muted">No product knowledge yet. Click <strong>+ Import product</strong> above (upload docs), or add it on a campaign.</p>
      ) : (
        <div className="post-summary-list">
          {entries.map((e) => (
            <div key={e.id} className="card" style={{ padding: 14 }}>
              <div className="spread">
                <button className="pk-lib-head" onClick={() => setOpenId((id) => (id === e.id ? null : e.id))}>
                  <div><strong>{e.name}</strong>
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      {e.language ?? 'no language'}{e.sourceDocs.length ? ` · ${e.sourceDocs.length} doc(s)` : ''} · updated {new Date(e.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {/* Short summary so the user scans their products at a glance without expanding. */}
                  {(summaryOf(e.profile) || e.productDetails) && (
                    <div className="muted small pk-summary">{summaryOf(e.profile) || e.productDetails}</div>
                  )}
                </button>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={() => startEdit(e)}>Edit</button>
                  <button className="btn small danger" onClick={() => void remove(e.id, e.name)}>Delete</button>
                </div>
              </div>

              {openId === e.id && editId !== e.id && (
                <div className="pk-result" style={{ marginTop: 10 }}>
                  <div className="copy-box"><div className="label">Product profile</div><div className="text">{e.productDetails}</div></div>
                  {e.brandVoice && <div className="row muted small" style={{ gap: 12, marginTop: 6 }}><span>Voice: {e.brandVoice}</span></div>}
                  {e.sourceDocs.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>Source docs: {e.sourceDocs.join(', ')}</div>}
                </div>
              )}

              {editId === e.id && (
                <div style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Name</label>
                    <input value={draft.name} onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Product profile</label>
                    <textarea rows={6} value={draft.productDetails} onChange={(ev) => setDraft((d) => ({ ...d, productDetails: ev.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Brand voice (optional)</label>
                    <input value={draft.brandVoice} onChange={(ev) => setDraft((d) => ({ ...d, brandVoice: ev.target.value }))} />
                  </div>
                  <div className="btn-row">
                    <button className="btn primary" disabled={saving} onClick={() => void save(e.id)}>{saving ? 'Saving…' : 'Save'}</button>
                    <button className="btn" disabled={saving} onClick={() => setEditId(null)}>Cancel</button>
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
          <div className="eyebrow">From your campaigns</div>
          <p className="muted small" style={{ margin: '2px 0 8px' }}>Knowledge you added on a campaign — it already grounds that campaign's posts. It is not a reusable library entry until imported.</p>
          <div className="post-summary-list">
            {campaignProducts.map((c) => (
              <div key={c.id} className="card" style={{ padding: 14 }}>
                <div><strong>{c.product}</strong> <span className="muted small">· campaign{c.language ? ` · ${c.language}` : ''}</span></div>
                {c.brandContext && <div className="muted small pk-summary">{c.brandContext}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
